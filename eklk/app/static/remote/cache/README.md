# Official RustDesk standalone (signed)

Used by `GET /api/v1/support/download/{helper,admin}-windows`.

Files are renamed on download to:

`rustdesk-host=<SUPPORT_RD_HOST>,key=<SUPPORT_RD_KEY>#.exe`

so the official client starts already pointed at our hbbs.

Do not replace with unsigned custom builds.
