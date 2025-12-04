#!/bin/bash
# ===================================================================================
# GOVCONNECT - DEPLOYMENT SCRIPT TO GCP VM
# ===================================================================================
#
# Prerequisites:
#   1. gcloud CLI installed dan sudah login
#   2. SSH key sudah dikonfigurasi
#   3. .env.production sudah diisi dengan values yang benar
#
# Usage:
#   ./scripts/deploy-to-vm.sh [command]
#
# Commands:
#   setup     - First time setup (install Docker, clone repo)
#   deploy    - Deploy/update aplikasi
#   logs      - View logs
#   status    - Check status
#   restart   - Restart all services
#   stop      - Stop all services
#
# ===================================================================================

set -e

# Configuration
VM_NAME="govconnect-vm"
VM_ZONE="asia-southeast2-a"
PROJECT_ID="$(gcloud config get-value project)"
REMOTE_DIR="/opt/govconnect"
REPO_URL="https://github.com/mygads/gov-connect-wa.git"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }

# SSH Command helper
ssh_cmd() {
    gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="$1"
}

# SCP helper
scp_to_vm() {
    gcloud compute scp "$1" $VM_NAME:"$2" --zone=$VM_ZONE
}

# ===================================================================================
# SETUP - First time installation
# ===================================================================================
setup() {
    log_info "Setting up VM for GovConnect..."
    
    # Install Docker & Docker Compose
    log_info "Installing Docker..."
    ssh_cmd "
        # Update system
        sudo apt-get update
        sudo apt-get upgrade -y
        
        # Install dependencies
        sudo apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release git
        
        # Add Docker GPG key
        curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
        
        # Add Docker repository
        echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian bullseye stable' | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
        
        # Install Docker
        sudo apt-get update
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
        
        # Add user to docker group
        sudo usermod -aG docker \$USER
        
        # Start Docker
        sudo systemctl enable docker
        sudo systemctl start docker
        
        echo 'Docker installed successfully!'
    "
    
    log_success "Docker installed!"
    
    # Create directory
    log_info "Creating project directory..."
    ssh_cmd "sudo mkdir -p $REMOTE_DIR && sudo chown \$USER:\$USER $REMOTE_DIR"
    
    # Clone repository
    log_info "Cloning repository..."
    ssh_cmd "
        cd $REMOTE_DIR
        if [ -d .git ]; then
            git pull origin main
        else
            git clone $REPO_URL .
        fi
    "
    
    log_success "Repository cloned!"
    
    # Upload .env.production
    upload_env
    
    log_success "Setup completed! Run './scripts/deploy-to-vm.sh deploy' to deploy."
}

# ===================================================================================
# UPLOAD ENV FILE
# ===================================================================================
upload_env() {
    log_info "Uploading .env.production..."
    
    if [ ! -f ".env.production" ]; then
        log_error ".env.production not found! Please create it first."
        exit 1
    fi
    
    scp_to_vm ".env.production" "$REMOTE_DIR/.env"
    log_success ".env file uploaded!"
}

# ===================================================================================
# DEPLOY - Deploy or update application
# ===================================================================================
deploy() {
    log_info "Deploying GovConnect to VM..."
    
    # Pull latest code
    log_info "Pulling latest code..."
    ssh_cmd "cd $REMOTE_DIR && git pull origin main"
    
    # Upload latest .env
    upload_env
    
    # Build and deploy with production profile
    log_info "Building and starting services..."
    ssh_cmd "
        cd $REMOTE_DIR/govconnect
        
        # Stop existing services
        docker compose down --remove-orphans || true
        
        # Pull/build images
        docker compose build --no-cache
        
        # Start with production profile (includes Traefik)
        docker compose --profile production up -d
        
        # Clean up old images
        docker image prune -f
        
        echo ''
        echo '=== Services Status ==='
        docker compose ps
    "
    
    log_success "Deployment completed!"
    
    # Show access info
    echo ""
    echo "=========================================="
    echo "GovConnect Deployed!"
    echo "=========================================="
    echo ""
    echo "VM External IP: 34.101.223.241"
    echo ""
    echo "Next steps:"
    echo "1. Configure DNS records:"
    echo "   - govconnect.my.id      A    34.101.223.241"
    echo "   - api.govconnect.my.id  A    34.101.223.241"
    echo ""
    echo "2. Wait for SSL certificates (Let's Encrypt)"
    echo ""
    echo "3. Access your services:"
    echo "   - Dashboard:  https://govconnect.my.id"
    echo "   - API:        https://api.govconnect.my.id"
    echo "   - RabbitMQ:   http://34.101.223.241:15672"
    echo "   - Traefik:    http://34.101.223.241:8080"
    echo ""
}

# ===================================================================================
# LOGS - View logs
# ===================================================================================
logs() {
    SERVICE=${1:-""}
    if [ -n "$SERVICE" ]; then
        ssh_cmd "cd $REMOTE_DIR/govconnect && docker compose logs -f $SERVICE"
    else
        ssh_cmd "cd $REMOTE_DIR/govconnect && docker compose logs -f --tail=100"
    fi
}

# ===================================================================================
# STATUS - Check status
# ===================================================================================
status() {
    log_info "Checking GovConnect status..."
    ssh_cmd "
        cd $REMOTE_DIR/govconnect
        echo ''
        echo '=== Docker Compose Services ==='
        docker compose ps
        echo ''
        echo '=== Disk Usage ==='
        df -h /
        echo ''
        echo '=== Memory Usage ==='
        free -h
        echo ''
        echo '=== Docker Stats ==='
        docker stats --no-stream
    "
}

# ===================================================================================
# RESTART - Restart services
# ===================================================================================
restart() {
    log_info "Restarting GovConnect services..."
    ssh_cmd "
        cd $REMOTE_DIR/govconnect
        docker compose --profile production restart
        docker compose ps
    "
    log_success "Services restarted!"
}

# ===================================================================================
# STOP - Stop services
# ===================================================================================
stop() {
    log_warning "Stopping GovConnect services..."
    ssh_cmd "cd $REMOTE_DIR/govconnect && docker compose --profile production down"
    log_success "Services stopped!"
}

# ===================================================================================
# SSH - Connect to VM
# ===================================================================================
connect() {
    log_info "Connecting to VM..."
    gcloud compute ssh $VM_NAME --zone=$VM_ZONE
}

# ===================================================================================
# MAIN
# ===================================================================================
case "${1:-deploy}" in
    setup)
        setup
        ;;
    deploy)
        deploy
        ;;
    logs)
        logs "$2"
        ;;
    status)
        status
        ;;
    restart)
        restart
        ;;
    stop)
        stop
        ;;
    connect|ssh)
        connect
        ;;
    upload-env)
        upload_env
        ;;
    *)
        echo "Usage: $0 {setup|deploy|logs|status|restart|stop|connect|upload-env}"
        echo ""
        echo "Commands:"
        echo "  setup      - First time setup (install Docker, clone repo)"
        echo "  deploy     - Deploy/update application"
        echo "  logs       - View logs (optional: service name)"
        echo "  status     - Check status of all services"
        echo "  restart    - Restart all services"
        echo "  stop       - Stop all services"
        echo "  connect    - SSH into VM"
        echo "  upload-env - Upload .env.production file only"
        exit 1
        ;;
esac
