# EKLK Remote — сервер (hbbs + hbbr)

```bash
mkdir -p data
# На Linux удобен network_mode: host
docker compose up -d
# Ключ сервера (для клиентов):
cat data/id_ed25519.pub
```

В `.env` EKLK:

```
SUPPORT_RD_HOST=remote.yourdomain.ru
SUPPORT_RD_KEY=<содержимое id_ed25519.pub>
SUPPORT_ADMIN_LOGINS=admin@example.com
```

Откройте порты **21115–21119** TCP/UDP на фаерволе.
