# Deploy 3DIPL On OVH

Target: Ubuntu VPS `51.79.158.33`, domain `3dipl.org`. Atlas remains the Core
database; the private Mongo container stores marketplace data; Google Drive
remains the asset source.

## 1. Prepare The VPS

```bash
ssh ubuntu@51.79.158.33
sudo apt update
sudo apt install -y ca-certificates curl git nginx certbot python3-certbot-nginx ufw fail2ban docker.io docker-compose-v2
sudo systemctl enable --now docker nginx fail2ban
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo install -d -o root -g root -m 700 /etc/3dipl/production
sudo install -d -o 1000 -g 1000 -m 755 /var/lib/3dipl/media/covers
sudo install -d -o 999 -g 999 -m 700 /var/lib/3dipl/mongo
sudo install -d -o 1000 -g 1000 -m 700 /var/lib/3dipl/backup-work
sudo install -d -o www-data -g www-data -m 755 /var/www/certbot
sudo git clone --branch release/production-readiness https://github.com/huynhee/getlink66.git /opt/3dipl/app
cd /opt/3dipl/app
```

Do not publish ports 5000, 8080, or 27017 in the VPS firewall.

## 2. Install Production Secrets

From the Windows project directory:

```powershell
scp backend/.env ubuntu@51.79.158.33:/tmp/backend.env
```

On the VPS:

```bash
sudo install -o root -g root -m 600 /tmp/backend.env /etc/3dipl/production/backend.env
rm /tmp/backend.env
```

The file must use `MONGO_MARKETPLACE_URI=mongodb://3dipl-mongo:27017/marketplace?replicaSet=rs0`, production HTTPS URLs, real Turnstile keys, and
`ALLOW_DEV_LOGIN=false`.

## 3. Start MongoDB Replica Set

```bash
cd /opt/3dipl/app
sudo docker compose -f compose.production.yml up -d mongo
sudo docker compose -f compose.production.yml exec mongo mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"3dipl-mongo:27017"}]})'
sudo docker compose -f compose.production.yml exec mongo mongosh --quiet --eval 'rs.status().ok'
```

The final command must print `1`. On later deployments, skip `rs.initiate`.

## 4. Preserve Existing Marketplace Data

Before switching traffic, stop writes on the old VPS and create a verified
marketplace backup. Restore it into the empty new replica set before starting the
backend. Do not use `--drop` unless the destination was verified as disposable.

```bash
sudo docker compose -f compose.production.yml exec -T mongo mongorestore --archive --gzip < /secure/path/marketplace.archive.gz
```

Atlas data is not restored into this container. Keep the old VPS unchanged for
at least 48 hours after cutover.

## 5. Start The Application

```bash
cd /opt/3dipl/app
sudo docker compose -f compose.production.yml build
sudo docker compose -f compose.production.yml up -d
sudo docker compose -f compose.production.yml ps
sudo docker compose -f compose.production.yml logs --tail=100 backend
curl -fsS http://127.0.0.1:5000/ready
curl -fsS http://127.0.0.1:8080/healthz
```

Only one backend container should run because the current process also owns
background workers.

## 6. Connect Nginx And DNS

```bash
sudo install -m 644 /opt/3dipl/app/ops/nginx/3dipl.conf /etc/nginx/sites-available/3dipl
sudo ln -sfn /etc/nginx/sites-available/3dipl /etc/nginx/sites-enabled/3dipl
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

In Cloudflare DNS, set `A @` to `51.79.158.33` and `CNAME www` to `3dipl.org`.
Use **DNS only** until the certificate succeeds, then run:

```bash
sudo certbot --nginx -d 3dipl.org -d www.3dipl.org --redirect
curl -fsS https://3dipl.org/ready
```

After HTTPS works, enable Cloudflare proxy and set SSL/TLS to **Full (strict)**.
Update Google OAuth redirect URI, Turnstile hostnames, and SePay webhook to the
production domain.

## 7. Future Deployments

```bash
cd /opt/3dipl/app
sudo git pull --ff-only
sudo docker compose -f compose.production.yml build
sudo docker compose -f compose.production.yml up -d
sudo docker image prune -f
curl -fsS https://3dipl.org/ready
```
