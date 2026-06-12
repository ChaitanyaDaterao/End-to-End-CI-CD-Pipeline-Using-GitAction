# Murum BMS — End-to-End DevSecOps CI/CD Pipeline

A full-stack Business Management System (React + Node.js/Express + MongoDB) with a complete DevSecOps pipeline built on GitHub Actions, Docker, Kubernetes (Helm), and AWS.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React (Nginx) |
| Backend | Node.js / Express |
| Database | MongoDB |
| Containerization | Docker (multi-stage builds) |
| Orchestration | Kubernetes via Helm (Minikube) |
| CI/CD | GitHub Actions |
| Registry | GitHub Container Registry (GHCR) |

---

## Pipeline Overview
Push to main

│

▼

┌─────────────────────────────┐

│  Step 3 — Security Gates   │

│  • Gitleaks (secret scan)   │

│  • CodeQL (SAST)            │

│  • Dependabot alerts        │

└────────────┬────────────────┘

│

▼

┌─────────────────────────────┐

│  Step 4 — CI Build & Scan  │

│  • Jest + Supertest tests   │

│  • Docker build (matrix)    │

│  • Trivy image scan → SARIF │

│  • Push to GHCR             │

│  • Syft SBOM generation     │

│  • Slack notification       │

└────────────┬────────────────┘

│

▼

┌─────────────────────────────┐

│  Step 5 — Deploy (Helm)    │

│  • Manual approval gate     │

│  • helm upgrade --install   │

│  • Rollout verification     │

│  • Slack notification       │

└────────────┬────────────────┘

│

▼

┌─────────────────────────────┐

│  Step 6 — DAST             │

│  • OWASP ZAP baseline scan  │

│  • HTML report artifact     │

└─────────────────────────────┘
---

## Steps

### Step 1 — Git & GitHub Setup
- Monorepo initialized with `.gitignore` and `server/.env.example`
- SSH authentication (WSL → GitHub)

### Step 2 — Dockerization
- Multi-stage Dockerfiles for server and client
- Nginx SPA routing + API proxy (`/api` → `server:5000`)
- `docker-compose.yml` for local development
- Non-root users, no debug scripts in production images

### Step 3 — Security Gates
- **Gitleaks** — secret scanning on every push/PR
- **CodeQL** — static analysis (JavaScript/TypeScript)
- **Dependabot** — automated dependency vulnerability alerts

### Step 4 — Build, Test & Scan
- Backend unit tests with Jest + Supertest
- Docker image builds via matrix strategy (server + client)
- **Trivy** vulnerability scanner → SARIF → GitHub Security tab
- Images pushed to GHCR tagged with git SHA and `latest`
- **Syft** SBOM generation in SPDX-JSON format (uploaded as artifacts)

### Step 5 — Deploy to Kubernetes (Helm)
- Helm chart at `charts/murum-bms/` with templates for server, client, and MongoDB
- Persistent volume for MongoDB data
- GitHub Environments `production` with required reviewer approval gate
- Self-hosted runner (WSL/Minikube) runs `helm upgrade --install`
- Rollout verification via `kubectl rollout status`

### Step 6 — DAST & Notifications
- **OWASP ZAP** baseline scan against deployed client URL
- ZAP HTML report uploaded as workflow artifact
- **Slack** notifications on CI and deploy completion (success/failure)

---

## Repository Structure
---

## Steps

### Step 1 — Git & GitHub Setup
- Monorepo initialized with `.gitignore` and `server/.env.example`
- SSH authentication (WSL → GitHub)

### Step 2 — Dockerization
- Multi-stage Dockerfiles for server and client
- Nginx SPA routing + API proxy (`/api` → `server:5000`)
- `docker-compose.yml` for local development
- Non-root users, no debug scripts in production images

### Step 3 — Security Gates
- **Gitleaks** — secret scanning on every push/PR
- **CodeQL** — static analysis (JavaScript/TypeScript)
- **Dependabot** — automated dependency vulnerability alerts

### Step 4 — Build, Test & Scan
- Backend unit tests with Jest + Supertest
- Docker image builds via matrix strategy (server + client)
- **Trivy** vulnerability scanner → SARIF → GitHub Security tab
- Images pushed to GHCR tagged with git SHA and `latest`
- **Syft** SBOM generation in SPDX-JSON format (uploaded as artifacts)

### Step 5 — Deploy to Kubernetes (Helm)
- Helm chart at `charts/murum-bms/` with templates for server, client, and MongoDB
- Persistent volume for MongoDB data
- GitHub Environments `production` with required reviewer approval gate
- Self-hosted runner (WSL/Minikube) runs `helm upgrade --install`
- Rollout verification via `kubectl rollout status`

### Step 6 — DAST & Notifications
- **OWASP ZAP** baseline scan against deployed client URL
- ZAP HTML report uploaded as workflow artifact
- **Slack** notifications on CI and deploy completion (success/failure)

---

## Repository Structure
---

## Local Setup

```bash
# Clone
git clone git@github.com:ChaitanyaDaterao/End-to-End-CI-CD-Pipeline-Using-GitAction.git
cd End-to-End-CI-CD-Pipeline-Using-GitAction

# Run with Docker Compose
docker compose up --build

# Deploy to Minikube
minikube start
helm install murum ./charts/murum-bms
kubectl get pods
minikube service murum-client
```

---

## Secrets Required

| Secret | Used In | Description |
|--------|---------|-------------|
| `GITHUB_TOKEN` | All workflows | Auto-provided by GitHub |
| `SLACK_WEBHOOK_URL` | CI + Deploy | Slack Incoming Webhook URL |

---

## GitHub Setup

1. **Environments** — Settings → Environments → create `production` with a required reviewer
2. **Self-hosted runner** — Settings → Actions → Runners → New self-hosted runner (register WSL machine)
3. **Slack webhook** — Settings → Secrets → Actions → add `SLACK_WEBHOOK_URL`
