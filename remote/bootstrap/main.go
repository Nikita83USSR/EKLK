// EKLK remote bootstrap for Windows: detect arch, download RustDesk, write server config.
// Build:
//   GOOS=windows GOARCH=386 go build -ldflags="-s -w" -o EKLK-Helper-Setup.exe -tags helper
//   GOOS=windows GOARCH=386 go build -ldflags="-s -w" -o EKLK-Admin-Setup.exe -tags admin
package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const rustdeskVersion = "1.3.9"

func mode() string {
	// set at build via -X main.buildMode=helper|admin
	if buildMode == "admin" {
		return "admin"
	}
	return "helper"
}

var buildMode = "helper"

func main() {
	fmt.Println("EKLK", mode(), "setup · RustDesk", rustdeskVersion)
	host, key := loadConfig()
	if host == "" {
		fmt.Println("Не задан EKLK_RD_HOST.")
		fmt.Println("Рядом с этим .exe положите файл eklk-remote.env:")
		fmt.Println("  EKLK_RD_HOST=remote.example.com")
		fmt.Println("  EKLK_RD_KEY=ваш_ключ_hbbs")
		writeTemplateEnv()
		fmt.Println("Шаблон записан. Заполните и запустите установщик снова.")
		waitExit(1)
		return
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
		fmt.Println("Скачайте вручную и сохраните как:", exePath)
		waitExit(1)
		return
	}
	fmt.Println("Сохранено:", exePath)

	if err := writeRustDeskConfig(host, key); err != nil {
		fail(err)
	}
	fmt.Println("Конфиг сервера записан (AppData\\RustDesk\\config).")

	// copy env next to install for reference
	_ = copyFile(envPathBesideExe(), filepath.Join(destDir, "eklk-remote.env"))

	fmt.Println()
	if mode() == "admin" {
		fmt.Println("Админ-клиент готов. Откройте ЛК → Поддержка → Подключиться, затем ID в RustDesk.")
	} else {
		fmt.Println("Помощник готов.")
		fmt.Println("1) Дождитесь ID в окне RustDesk")
		fmt.Println("2) ЛК EKLK → Помощник → вставьте ID → «Я в сети»")
	}
	fmt.Println("Запуск RustDesk…")
	_ = exec.Command(exePath).Start()
	waitExit(0)
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
	// PROCESSOR_ARCHITECTURE: AMD64, x86, ARM64
	pa := strings.ToUpper(os.Getenv("PROCESSOR_ARCHITECTURE"))
	paW6432 := strings.ToUpper(os.Getenv("PROCESSOR_ARCHITEW6432"))
	is64 := pa == "AMD64" || pa == "ARM64" || paW6432 == "AMD64" || paW6432 == "ARM64"
	// 32-bit process on 64-bit OS still sees AMD64 via PROCESSOR_ARCHITEW6432
	if !is64 && runtime.GOARCH == "amd64" {
		is64 = true
	}
	if is64 {
		return "x86_64", base + "rustdesk-" + rustdeskVersion + "-x86_64.exe"
	}
	return "x86-sciter", base + "rustdesk-" + rustdeskVersion + "-x86-sciter.exe"
}

func loadConfig() (host, key string) {
	host = strings.TrimSpace(os.Getenv("EKLK_RD_HOST"))
	key = strings.TrimSpace(os.Getenv("EKLK_RD_KEY"))
	paths := []string{
		envPathBesideExe(),
		filepath.Join(installDir(), "eklk-remote.env"),
	}
	for _, p := range paths {
		h, k := parseEnvFile(p)
		if host == "" {
			host = h
		}
		if key == "" {
			key = k
		}
	}
	return host, key
}

func envPathBesideExe() string {
	exe, err := os.Executable()
	if err != nil {
		return "eklk-remote.env"
	}
	return filepath.Join(filepath.Dir(exe), "eklk-remote.env")
}

func parseEnvFile(path string) (host, key string) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "EKLK_RD_HOST=") {
			host = strings.TrimSpace(strings.TrimPrefix(line, "EKLK_RD_HOST="))
			host = strings.Trim(host, `"'`)
		}
		if strings.HasPrefix(line, "EKLK_RD_KEY=") {
			key = strings.TrimSpace(strings.TrimPrefix(line, "EKLK_RD_KEY="))
			key = strings.Trim(key, `"'`)
		}
	}
	return host, key
}

func writeTemplateEnv() {
	p := envPathBesideExe()
	_ = os.WriteFile(p, []byte("EKLK_RD_HOST=\nEKLK_RD_KEY=\nEKLK_API_BASE=\n"), 0644)
	fmt.Println("Создан:", p)
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
