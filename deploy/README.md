# EREBUS Morpho Bot - VPS Deployment

Docker deployment for the Morpho Blue liquidation bot on HyperEVM.

## Prerequisites

- Docker Engine 24+
- Docker Compose v2 (plugin)
- Git

## Initial Setup

### 1. Install Docker on VPS

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in for group change to take effect
```

### 2. Clone Repository

```bash
cd /srv
git clone <repo-url> EREBUS
cd EREBUS
```

### 3. Configure Environment

```bash
# Copy template
cp deploy/env.morpho.template deploy/.env.morpho

# Edit with your secrets
nano deploy/.env.morpho

# Secure permissions (critical for private key)
chmod 600 deploy/.env.morpho
```

**Required secrets to fill in:**
- `LIQUIDATION_PRIVATE_KEY_999` - Wallet private key (NO 0x prefix)
- `FLASHLOAN_EXECUTOR_ADDRESS_999` - Deployed executor contract
- `TELEGRAM_TOKEN` - Bot token from @BotFather

### 4. Start the Bot

```bash
# Build and start
pnpm docker:morpho:up

# Or without pnpm:
docker compose -f deploy/docker-compose.morpho.yml up -d --build
```

## Operations

### Check Status

```bash
# Health endpoint
curl http://127.0.0.1:4001/health

# Ready endpoint (200 after first tick)
curl http://127.0.0.1:4001/ready

# Container logs
pnpm docker:morpho:logs

# Or:
docker compose -f deploy/docker-compose.morpho.yml logs -f --tail=200
```

### Update Deployment

```bash
cd /srv/EREBUS
git pull
pnpm docker:morpho:up
```

The `--build` flag in `docker:morpho:up` ensures the image is rebuilt with new code.

### Stop the Bot

```bash
pnpm docker:morpho:down
```

### Restart

```bash
docker compose -f deploy/docker-compose.morpho.yml restart
```

## Health Response

```json
{
  "status": "ok",
  "startedAt": "2025-01-16T12:00:00.000Z",
  "lastTickAt": "2025-01-16T12:05:30.000Z",
  "lastTickDurationMs": 1234,
  "lastErrorAt": null,
  "mode": "BASE",
  "executionEnabled": true
}
```

- `status: "ok"` - Normal operation
- `status: "degraded"` - Last tick older than `2 * TICK_BASE_SECONDS + 30s`

## Security Notes

1. **Never commit `.env.morpho`** - Contains private key
2. **Restrict file permissions**: `chmod 600 deploy/.env.morpho`
3. **Health port bound to localhost only** - Not exposed to internet
4. **Run as non-root** - Container uses dedicated `nodejs` user

### Optional: Expose Health Behind Auth

For external monitoring, use a reverse proxy with authentication:

```nginx
# /etc/nginx/sites-available/erebus-health
server {
    listen 443 ssl;
    server_name health.yourdomain.com;
    
    auth_basic "EREBUS Health";
    auth_basic_user_file /etc/nginx/.htpasswd;
    
    location / {
        proxy_pass http://127.0.0.1:4001;
    }
}
```

Or with Caddy:

```
health.yourdomain.com {
    basicauth * {
        admin $2a$14$...
    }
    reverse_proxy 127.0.0.1:4001
}
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose -f deploy/docker-compose.morpho.yml logs

# Verify env file exists
ls -la deploy/.env.morpho

# Test build
docker compose -f deploy/docker-compose.morpho.yml build
```

### Health returns degraded

- Check if scheduler is stuck (look at logs)
- Verify RPC connectivity
- Check `lastErrorAt` in health response

### Permission denied on .env.morpho

```bash
# Ensure file is readable by current user
chmod 600 deploy/.env.morpho
chown $USER:$USER deploy/.env.morpho
```

## File Structure

```
deploy/
├── docker-compose.morpho.yml  # Compose config
├── env.morpho.template        # Environment template
├── .env.morpho                # Your secrets (gitignored)
└── README.md                  # This file

apps/morpho-bot/
├── Dockerfile                 # Container build
└── src/
    └── lib/
        └── health.js          # Health server
```
