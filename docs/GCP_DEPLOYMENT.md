# 🚀 GovConnect - Deployment ke Google Cloud Platform (GCP)

Panduan lengkap untuk deploy GovConnect ke GCP menggunakan Google Kubernetes Engine (GKE).

## 📋 Prerequisites

1. **GCP Account** dengan billing enabled
2. **gcloud CLI** terinstall dan terkonfigurasi
3. **kubectl** terinstall
4. **Docker** terinstall (untuk build images)
5. **Domain** yang sudah disiapkan (govconnect.my.id)

## 🏗️ Arsitektur GCP

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Google Cloud Platform                            │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Cloud Load Balancer (HTTPS)                                 │   │
│  │  - govconnect.my.id                                         │   │
│  │  - api.govconnect.my.id                                     │   │
│  └────────────────────────┬────────────────────────────────────┘   │
│                           │                                         │
│  ┌────────────────────────▼────────────────────────────────────┐   │
│  │  Google Kubernetes Engine (GKE)                              │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │   │
│  │  │ Channel Svc │ │ AI Service  │ │ Case Service│            │   │
│  │  │   (3001)    │ │   (3002)    │ │   (3003)    │            │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘            │   │
│  │  ┌─────────────┐ ┌─────────────┐                             │   │
│  │  │ Notif. Svc  │ │  Dashboard  │                             │   │
│  │  │   (3004)    │ │   (3000)    │                             │   │
│  │  └─────────────┘ └─────────────┘                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────┐  ┌─────────────────────────────────────┐  │
│  │ Cloud SQL (PostgreSQL) │  │ Memorystore (Redis) - Optional   │  │
│  │ - govconnect DB        │  │                                   │  │
│  └─────────────────────┘  └─────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Artifact Registry (Container Images)                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## 🔧 Step 1: Setup GCP Project

```bash
# Login ke GCP
gcloud auth login

# Set project ID (ganti dengan project ID Anda)
export GCP_PROJECT_ID="govconnect-project"
export GCP_REGION="asia-southeast2"
export GCP_ZONE="asia-southeast2-a"

# Create project (jika belum ada)
gcloud projects create $GCP_PROJECT_ID --name="GovConnect"

# Set project aktif
gcloud config set project $GCP_PROJECT_ID
gcloud config set compute/region $GCP_REGION
gcloud config set compute/zone $GCP_ZONE

# Enable required APIs
gcloud services enable container.googleapis.com
gcloud services enable artifactregistry.googleapis.com
gcloud services enable sqladmin.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable cloudresourcemanager.googleapis.com
```

## 🐳 Step 2: Setup Artifact Registry

```bash
# Create Artifact Registry repository
gcloud artifacts repositories create govconnect \
    --repository-format=docker \
    --location=$GCP_REGION \
    --description="GovConnect container images"

# Configure Docker to use Artifact Registry
gcloud auth configure-docker ${GCP_REGION}-docker.pkg.dev
```

## ☸️ Step 3: Create GKE Cluster

```bash
# Create GKE Autopilot cluster (recommended - managed & cost-effective)
gcloud container clusters create-auto govconnect-cluster \
    --region=$GCP_REGION \
    --project=$GCP_PROJECT_ID

# ATAU: Create Standard GKE cluster (more control)
gcloud container clusters create govconnect-cluster \
    --num-nodes=3 \
    --machine-type=e2-medium \
    --disk-size=50GB \
    --zone=$GCP_ZONE \
    --enable-autoscaling \
    --min-nodes=2 \
    --max-nodes=5 \
    --enable-autorepair \
    --enable-autoupgrade

# Get credentials for kubectl
gcloud container clusters get-credentials govconnect-cluster \
    --region=$GCP_REGION \
    --project=$GCP_PROJECT_ID

# Verify connection
kubectl cluster-info
```

## 🗄️ Step 4: Setup Cloud SQL (PostgreSQL)

```bash
# Create Cloud SQL instance
gcloud sql instances create govconnect-db \
    --database-version=POSTGRES_16 \
    --tier=db-custom-1-3840 \
    --region=$GCP_REGION \
    --storage-type=SSD \
    --storage-size=20GB \
    --storage-auto-increase \
    --backup-start-time="03:00" \
    --availability-type=REGIONAL

# Set root password
gcloud sql users set-password postgres \
    --instance=govconnect-db \
    --password="YOUR_STRONG_PASSWORD_HERE"

# Create database
gcloud sql databases create govconnect --instance=govconnect-db

# Get connection name (untuk digunakan di Kubernetes)
gcloud sql instances describe govconnect-db --format='value(connectionName)'
```

## 🔐 Step 5: Setup Secret Manager

```bash
# Store secrets in GCP Secret Manager
echo -n "YOUR_DB_PASSWORD" | gcloud secrets create db-password --data-file=-
echo -n "YOUR_RABBITMQ_PASSWORD" | gcloud secrets create rabbitmq-password --data-file=-
echo -n "YOUR_INTERNAL_API_KEY" | gcloud secrets create internal-api-key --data-file=-
echo -n "YOUR_JWT_SECRET" | gcloud secrets create jwt-secret --data-file=-
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=-
echo -n "YOUR_WA_ACCESS_TOKEN" | gcloud secrets create wa-access-token --data-file=-

# Grant access to GKE service account
PROJECT_NUMBER=$(gcloud projects describe $GCP_PROJECT_ID --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding db-password \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
```

## 📦 Step 6: Build & Push Docker Images

```bash
# Set image prefix
export IMAGE_PREFIX="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/govconnect"

# Build dan push semua services
cd govconnect

# Build Channel Service
docker build -t ${IMAGE_PREFIX}/channel-service:latest ./govconnect-channel-service
docker push ${IMAGE_PREFIX}/channel-service:latest

# Build AI Service
docker build -t ${IMAGE_PREFIX}/ai-service:latest ./govconnect-ai-service
docker push ${IMAGE_PREFIX}/ai-service:latest

# Build Case Service
docker build -t ${IMAGE_PREFIX}/case-service:latest ./govconnect-case-service
docker push ${IMAGE_PREFIX}/case-service:latest

# Build Notification Service
docker build -t ${IMAGE_PREFIX}/notification-service:latest ./govconnect-notification-service
docker push ${IMAGE_PREFIX}/notification-service:latest

# Build Dashboard
docker build -t ${IMAGE_PREFIX}/dashboard:latest ./govconnect-dashboard
docker push ${IMAGE_PREFIX}/dashboard:latest
```

## ☸️ Step 7: Deploy ke GKE

```bash
# Update konfigurasi K8s untuk GCP
cd k8s/gcp

# Apply namespace
kubectl apply -f 00-namespace.yaml

# Apply secrets (update dulu values-nya!)
kubectl apply -f 02-secrets-gcp.yaml

# Apply configmaps
kubectl apply -f 01-configmap-gcp.yaml

# Deploy Cloud SQL Proxy (untuk koneksi ke Cloud SQL)
kubectl apply -f 05-cloud-sql-proxy.yaml

# Deploy RabbitMQ
kubectl apply -f 11-rabbitmq.yaml

# Deploy services
kubectl apply -f 20-channel-service.yaml
kubectl apply -f 21-ai-service.yaml
kubectl apply -f 22-case-service.yaml
kubectl apply -f 23-notification-service.yaml
kubectl apply -f 24-dashboard.yaml

# Deploy Ingress
kubectl apply -f 30-ingress-gcp.yaml
```

## 🌐 Step 8: Setup Domain & SSL

```bash
# Get External IP from Ingress
kubectl get ingress -n govconnect

# Update DNS records:
# - govconnect.my.id      A    <EXTERNAL_IP>
# - api.govconnect.my.id  A    <EXTERNAL_IP>

# SSL akan otomatis ter-provision oleh Google-managed SSL certificate
```

## ✅ Step 9: Verify Deployment

```bash
# Check all pods
kubectl get pods -n govconnect

# Check services
kubectl get svc -n govconnect

# Check ingress
kubectl get ingress -n govconnect

# View logs
kubectl logs -f deployment/channel-service -n govconnect
kubectl logs -f deployment/ai-service -n govconnect

# Test health endpoints
curl https://api.govconnect.my.id/channel/health
curl https://api.govconnect.my.id/case/health
curl https://govconnect.my.id/api/health
```

## 💰 Estimasi Biaya (Per Bulan)

| Resource | Spec | Estimated Cost |
|----------|------|----------------|
| GKE Autopilot | ~2 vCPU, 4GB RAM avg | $50-100 |
| Cloud SQL | db-custom-1-3840 | $40-60 |
| Load Balancer | 1 Ingress | $18 |
| Artifact Registry | 5GB | $5 |
| **Total** | | **~$113-183/month** |

> 💡 Untuk development/testing, gunakan GKE Autopilot yang hanya charge berdasarkan pod usage.

## 🔄 CI/CD dengan GitHub Actions

Lihat file `.github/workflows/ci-cd-gcp.yml` untuk konfigurasi CI/CD otomatis.

## 🛠️ Troubleshooting

### Pod tidak bisa start
```bash
kubectl describe pod <pod-name> -n govconnect
kubectl logs <pod-name> -n govconnect --previous
```

### Database connection error
```bash
# Check Cloud SQL Proxy
kubectl logs -f deployment/cloud-sql-proxy -n govconnect

# Test connection
kubectl exec -it deployment/channel-service -n govconnect -- psql $DATABASE_URL
```

### Ingress tidak mendapat external IP
```bash
kubectl describe ingress govconnect-ingress -n govconnect
# Pastikan GKE HTTP Load Balancing addon enabled
```

## 📚 Resources

- [GKE Documentation](https://cloud.google.com/kubernetes-engine/docs)
- [Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres)
- [Artifact Registry](https://cloud.google.com/artifact-registry/docs)
- [GKE Ingress](https://cloud.google.com/kubernetes-engine/docs/concepts/ingress)
