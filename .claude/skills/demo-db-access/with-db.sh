#!/usr/bin/env bash
# with-db.sh — Abre acceso temporal al RDS demo (EdTech / AcademOS), corre lo que le
# pases con DATABASE_ADMIN_URL exportada, y REVIERTE siempre (trap EXIT).
#
# Uso (correr en BACKGROUND; tarda ~10-12 min por los modify-db-instance):
#   bash with-db.sh 'pnpm --filter @soe/db exec tsx /ruta/query.ts'
#
# El password del master lo lee del SST secret DbMasterPassword (o pásalo por env DB_MASTER_PW).
# NO solapar dos ventanas de acceso (modifies concurrentes → InvalidDBInstanceState).

set +e
export AWS_PROFILE="${AWS_PROFILE:-edtech}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

DBID=edtech-demo-dbinstance-cauoeshr
HOST=edtech-demo-dbinstance-cauoeshr.cm9sce4qi665.us-east-1.rds.amazonaws.com
SG=sg-002c9fafa71da550a
IGW=igw-008f7bef242080563
RTBS="rtb-056f639f179afee49 rtb-0afd0f626d2e3622b"   # bash SÍ splitea; zsh NO (usar bash)
WORKTREE="${WORKTREE:-/Users/macbook/Dropbox/Mi Mac (MacBook Pro de MacBook)/Desktop/EdTech/infra-aws-sst}"

# --- password del master (soe_admin) ---
if [ -z "$DB_MASTER_PW" ]; then
  DB_MASTER_PW=$(cd "$WORKTREE" && npx sst secret list --stage demo 2>/dev/null | awk -F' = ' '/^DbMasterPassword/{print $2}')
fi
[ -z "$DB_MASTER_PW" ] && { echo "ERROR: falta DB_MASTER_PW (no se pudo leer el SST secret DbMasterPassword)"; exit 1; }
export DATABASE_ADMIN_URL="postgresql://soe_admin:${DB_MASTER_PW}@${HOST}:5432/soe"

MYIP=$(curl -s https://checkip.amazonaws.com | tr -d '[:space:]')

revert() {
  echo ">>> REVERT — cerrando acceso al RDS"
  for RTB in $RTBS; do aws ec2 delete-route --route-table-id "$RTB" --destination-cidr-block 0.0.0.0/0 >/dev/null 2>&1; done
  aws ec2 revoke-security-group-ingress --group-id "$SG" --protocol tcp --port 5432 --cidr "${MYIP}/32" >/dev/null 2>&1
  aws rds modify-db-instance --db-instance-identifier "$DBID" --no-publicly-accessible --apply-immediately >/dev/null 2>&1
  local P=""
  for i in $(seq 1 30); do
    P=$(aws rds describe-db-instances --db-instance-identifier "$DBID" --query 'DBInstances[0].PubliclyAccessible' --output text 2>/dev/null)
    [ "$P" = "False" ] && break
    sleep 15
  done
  echo ">>> RDS PubliclyAccessible=$P (debe ser False)"
}
trap revert EXIT

echo ">>> abriendo acceso temporal (IP $MYIP)"
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 5432 --cidr "${MYIP}/32" >/dev/null 2>&1
for RTB in $RTBS; do aws ec2 create-route --route-table-id "$RTB" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW" >/dev/null 2>&1; done
aws rds modify-db-instance --db-instance-identifier "$DBID" --publicly-accessible --apply-immediately >/dev/null 2>&1
sleep 30
aws rds wait db-instance-available --db-instance-identifier "$DBID"
for i in $(seq 1 20); do nc -z -w5 "$HOST" 5432 2>/dev/null && { echo ">>> TCP OK"; break; } || sleep 15; done

echo ">>> ejecutando: $*"
eval "$@"
CODE=$?
echo ">>> comando exit=$CODE"
exit $CODE
