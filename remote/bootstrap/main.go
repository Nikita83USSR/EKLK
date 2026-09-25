// EKLK remote bootstrap for Windows.
// helper: install RustDesk + server config
// admin: login to EKLK API, require support admin, then install RustDesk
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"golang.org/x/term"
)

const rustdeskVersion = "1.3.9"

var buildMode = "helper"

func mode() string {
	if buildMode == "admin" {
		return "admin"
	}
	return "helper"
}

func main() {
	fmt.Println("EKLK", mode(), "setup · RustDesk", rustdeskVersion)

	host, key, apiBase := loadConfig()
	if host == "" {
		fmt.Println("Не задан EKLK_RD_HOST.")
		fmt.Println("Рядом с .exe положите eklk-remote.env:")
		fmt.Println("  EKLK_RD_HOST=remote.example.com")
		fmt.Println("  EKLK_RD_KEY=ключ_hbbs")
		if mode() == "admin" {
			fmt.Println("  EKLK_API_BASE=https://your-eklk-host")
		}
		writeTemplateEnv()
		waitExit(1)
		return
	}

	if mode() == "admin" {
		if apiBase == "" {
			fmt.Println("Для админ-клиента нужен EKLK_API_BASE в eklk-remote.env")
			fmt.Println("Пример: EKLK_API_BASE=https://lk.example.com")
			writeTemplateEnv()
			waitExit(1)
			return
		}
		if err := adminLogin(apiBase); err != nil {
			fmt.Println("Авторизация не удалась:", err)
			waitExit(1)
			return
		}
		fmt.Println("Доступ администратора поддержки подтверждён.")
	}

	arch, url := rustdeskURL()
	fmt.Println("Архитектура:", arch)
	fmt.Println("Загрузка:", url)

	destDir := installDir()
	if err := os.MkdirAll(destDir, 0755); err != nil {
		fail(err)
	}
	exePath := filepath.Join(destDir, "rustdesk.exe")
	if err := download(url, exePath); err != nil {
		fmt.Println("Ошибка загрузки:", err)
		fmt.Println("Скачайте вручную:", url)
		fmt.Println("Сохраните как:", exePath)
		waitExit(1)
		return
	}
	fmt.Println("Сохранено:", exePath)

	if err := writeRustDeskConfig(host, key); err != nil {
		fail(err)
	}
	fmt.Println("Конфиг сервера записан.")

	_ = copyFile(envPathBesideExe(), filepath.Join(destDir, "eklk-remote.env"))

	fmt.Println()
	if mode() == "admin" {
		fmt.Println("Админ-клиент готов.")
		fmt.Println("Дальше: ЛК → Поддержка → Подключиться → ID клиента в RustDesk.")
	} else {
		fmt.Println("Помощник готов.")
		fmt.Println("1) Дождитесь ID в RustDesk")
		fmt.Println("2) ЛК → Помощник → ID → «Я в сети»")
	}
	fmt.Println("Запуск RustDesk…")
	_ = exec.Command(exePath).Start()
	waitExit(0)
}

func adminLogin(apiBase string) error {
	apiBase = strings.TrimRight(apiBase, "/")
	reader := bufio.NewReader(os.Stdin)

	fmt.Println()
	fmt.Println("Авторизация на сервере EKLK (логин/пароль EcomKassa)")
	fmt.Print("Логин: ")
	user, _ := reader.ReadString('\n')
	user = strings.TrimSpace(user)
	if user == "" {
		return fmt.Errorf("пустой логин")
	}
	fmt.Print("Пароль: ")
	passBytes, err := term.ReadPassword(int(syscall.Stdin))
	fmt.Println()
	if err != nil {
		// fallback visible input (некоторые консоли Windows)
		pass, _ := reader.ReadString('\n')
		passBytes = []byte(strings.TrimSpace(pass))
	}
	password := string(passBytes)
	if password == "" {
		return fmt.Errorf("пустой пароль")
	}

	body, _ := json.Marshal(map[string]any{
		"username": user,
		"password": password,
		"remember": false,
	})
	client := &http.Client{Timeout: 45 * time.Second}
	req, err := http.NewRequest("POST", apiBase+"/api/v1/auth/login", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("нет связи с %s: %w", apiBase, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return fmt.Errorf("вход отклонён (HTTP %d): %s", resp.StatusCode, truncate(string(raw), 200))
	}
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(raw, &tok); err != nil || tok.AccessToken == "" {
		return fmt.Errorf("некорректный ответ login")
	}

	req2, err := http.NewRequest("GET", apiBase+"/api/v1/support/me", nil)
	if err != nil {
		return err
	}
	req2.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	resp2, err := client.Do(req2)
	if err != nil {
		return err
	}
	defer resp2.Body.Close()
	raw2, _ := io.ReadAll(resp2.Body)
	if resp2.StatusCode != 200 {
		return fmt.Errorf("проверка роли (HTTP %d): %s", resp2.StatusCode, truncate(string(raw2), 200))
	}
	var me struct {
		IsAdmin bool   `json:"is_admin"`
		Login   string `json:"login"`
	}
	if err := json.Unmarshal(raw2, &me); err != nil {
		return err
	}
	if !me.IsAdmin {
		return fmt.Errorf("пользователь %q не в SUPPORT_ADMIN_LOGINS — доступ запрещён", user)
	}

	// сохранить токен локально (опционально для будущих вызовов)
	dest := installDir()
	_ = os.MkdirAll(dest, 0755)
	_ = os.WriteFile(filepath.Join(dest, "eklk_admin_token.txt"), []byte(tok.AccessToken), 0600)
	_ = os.WriteFile(filepath.Join(dest, "eklk_admin_login.txt"), []byte(me.Login), 0600)
	return nil
}

func truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func installDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = os.TempDir()
	}
	if mode() == "admin" {
		return filepath.Join(base, "EKLK-Admin")
	}
	return filepath.Join(base, "EKLK-Helper")
}

func rustdeskURL() (label, url string) {
	base := "https://github.com/rustdesk/rustdesk/releases/download/" + rustdeskVersion + "/"
	pa := strings.ToUpper(os.Getenv("PROCESSOR_ARCHITECTURE"))
	paW6432 := strings.ToUpper(os.Getenv("PROCESSOR_ARCHITEW6432"))
	is64 := pa == "AMD64" || pa == "ARM64" || paW6432 == "AMD64" || paW6432 == "ARM64"
	if !is64 && runtime.GOARCH == "amd64" {
		is64 = true
	}
	if is64 {
		return "x86_64", base + "rustdesk-" + rustdeskVersion + "-x86_64.exe"
	}
	return "x86-sciter", base + "rustdesk-" + rustdeskVersion + "-x86-sciter.exe"
}

func loadConfig() (host, key, apiBase string) {
	host = strings.TrimSpace(os.Getenv("EKLK_RD_HOST"))
	key = strings.TrimSpace(os.Getenv("EKLK_RD_KEY"))
	apiBase = strings.TrimSpace(os.Getenv("EKLK_API_BASE"))
	for _, p := range []string{envPathBesideExe(), filepath.Join(installDir(), "eklk-remote.env")} {
		h, k, a := parseEnvFile(p)
		if host == "" {
			host = h
		}
		if key == "" {
			key = k
		}
		if apiBase == "" {
			apiBase = a
		}
	}
	return host, key, apiBase
}

func envPathBesideExe() string {
	exe, err := os.Executable()
	if err != nil {
		return "eklk-remote.env"
	}
	return filepath.Join(filepath.Dir(exe), "eklk-remote.env")
}

func parseEnvFile(path string) (host, key, apiBase string) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", "", ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		switch {
		case strings.HasPrefix(line, "EKLK_RD_HOST="):
			host = strings.Trim(strings.TrimSpace(strings.TrimPrefix(line, "EKLK_RD_HOST=")), `"'`)
		case strings.HasPrefix(line, "EKLK_RD_KEY="):
			key = strings.Trim(strings.TrimSpace(strings.TrimPrefix(line, "EKLK_RD_KEY=")), `"'`)
		case strings.HasPrefix(line, "EKLK_API_BASE="):
			apiBase = strings.Trim(strings.TrimSpace(strings.TrimPrefix(line, "EKLK_API_BASE=")), `"'`)
		}
	}
	return host, key, apiBase
}

func writeTemplateEnv() {
	p := envPathBesideExe()
	content := "EKLK_RD_HOST=\nEKLK_RD_KEY=\nEKLK_API_BASE=\n"
	_ = os.WriteFile(p, []byte(content), 0644)
	fmt.Println("Создан шаблон:", p)
}

func writeRustDeskConfig(host, key string) error {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		return fmt.Errorf("APPDATA пуст")
	}
	dir := filepath.Join(appData, "RustDesk", "config")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	content := fmt.Sprintf(`rendezvous_server = '%s'
nat_type = 1
serial = 0

[options]
custom-rendezvous-server = '%s'
key = '%s'
allow-remote-config-modification = 'N'
direct-server = 'Y'
approve-mode = 'password'
`, host, host, key)
	return os.WriteFile(filepath.Join(dir, "RustDesk2.toml"), []byte(content), 0644)
}

func download(url, dest string) error {
	client := &http.Client{Timeout: 10 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	tmp := dest + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	_, err = io.Copy(f, resp.Body)
	cerr := f.Close()
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if cerr != nil {
		_ = os.Remove(tmp)
		return cerr
	}
	_ = os.Remove(dest)
	return os.Rename(tmp, dest)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	cerr := out.Close()
	if err != nil {
		return err
	}
	return cerr
}

func fail(err error) {
	fmt.Println("Ошибка:", err)
	waitExit(1)
}

func waitExit(code int) {
	fmt.Println("Нажмите Enter…")
	_, _ = fmt.Scanln()
	os.Exit(code)
}
