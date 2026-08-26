#!/usr/bin/env bash

set -u

BASE_URL="${BASE_URL:-https://newpip.digitalvs.com}"
API_PATH="${API_PATH:-}"
API_POST_PATH="${API_POST_PATH:-}"
TOKEN="${TOKEN:-}"
LOGIN_EMAIL="${WAF_LOGIN_EMAIL:-}"
LOGIN_PASSWORD="${WAF_LOGIN_PASSWORD:-}"
OUTPUT_FILE="${WAF_TEST_OUTPUT:-waf-test-results.tsv}"
DRY_RUN=0
INCLUDE_RATE_LIMIT=0
ORIGIN_IP="${ORIGIN_IP:-}"
RATE_LIMIT_REQUESTS=5
RATE_LIMIT_DELAY=1

usage() {
  cat <<'EOF'
Uso:
  scripts/test-waf.sh [opciones]

Opciones:
  --base-url URL       Dominio objetivo (default: https://newpip.digitalvs.com)
  --api-path RUTA      Endpoint API de pruebas, por ejemplo /api/accounts
  --api-post-path RUTA Endpoint API POST de pruebas no destructivas (opcional)
  --login-email EMAIL  Usuario valido de pruebas para generar TOKEN
  --login-password PWD Password de pruebas (mejor usar prompt o variable de entorno)
  --token TOKEN        Token temporal para una prueba autenticada
  --origin-ip IP       IP real de la VM para probar bypass del WAF
  --output ARCHIVO     Archivo TSV de resultados
  --dry-run            Muestra las pruebas sin enviar solicitudes
  --rate-limit         Ejecuta una prueba corta y controlada de rate limiting
  -h, --help           Muestra esta ayuda

Variables equivalentes: BASE_URL, API_PATH, API_POST_PATH, TOKEN,
WAF_LOGIN_EMAIL, WAF_LOGIN_PASSWORD, ORIGIN_IP y WAF_TEST_OUTPUT.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="${2:?Falta el valor de --base-url}"
      shift 2
      ;;
    --api-path)
      API_PATH="${2:?Falta el valor de --api-path}"
      shift 2
      ;;
    --api-post-path)
      API_POST_PATH="${2:?Falta el valor de --api-post-path}"
      shift 2
      ;;
    --login-email)
      LOGIN_EMAIL="${2:?Falta el valor de --login-email}"
      shift 2
      ;;
    --login-password)
      LOGIN_PASSWORD="${2:?Falta el valor de --login-password}"
      shift 2
      ;;
    --token)
      TOKEN="${2:?Falta el valor de --token}"
      shift 2
      ;;
    --origin-ip)
      ORIGIN_IP="${2:?Falta el valor de --origin-ip}"
      shift 2
      ;;
    --output)
      OUTPUT_FILE="${2:?Falta el valor de --output}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --rate-limit)
      INCLUDE_RATE_LIMIT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Opcion desconocida: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

BASE_URL="${BASE_URL%/}"
if [[ "$BASE_URL" != https://* ]]; then
  echo "Advertencia: el objetivo no usa HTTPS: $BASE_URL" >&2
fi

HOSTNAME="${BASE_URL#https://}"
HOSTNAME="${HOSTNAME%%/*}"
TMP_DIR="$(mktemp -d)"
RESULTS=0
TOTAL=0

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if [[ ! -f "$OUTPUT_FILE" ]]; then
  printf 'test_id\tutc\tmethod\turl\tscenario\texpected_behavior\thttp_status\tresult\tresult_classification\tnotes\n' > "$OUTPUT_FILE"
fi

result_classification() {
  local status="$1"

  case "$status" in
    000) echo 'connection_failed' ;;
    200|201|202|204) echo 'success' ;;
    301|302|304) echo 'redirect' ;;
    400|401|403|404|405|406|429) echo 'blocked_or_rate_limited' ;;
    500|502|503|504) echo 'server_error' ;;
    *) echo 'unexpected_status' ;;
  esac
}

append_result_row() {
  local test_id="$1"
  local utc_ts="$2"
  local method="$3"
  local url="$4"
  local scenario="$5"
  local expected_behavior="$6"
  local http_status="$7"
  local result="$8"
  local result_classification="$9"
  local notes="${10:-}"

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$test_id" "$utc_ts" "$method" "$url" "$scenario" "$expected_behavior" "$http_status" "$result" "$result_classification" "$notes" >> "$OUTPUT_FILE"
}

urlencode() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$1"
  else
    printf '%s' "$1"
  fi
}

run_request() {
  local test_id="$1"
  local expected="$2"
  local scenario="${3:-$test_id}"
  shift 2
  TOTAL=$((TOTAL + 1))
  local now
  now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local request_method="${WAF_METHOD:-GET}"
  local request_url="${WAF_URL:-N/A}"
  local result="REVIEW"
  local classification
  local notes

  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[DRY-RUN] %s | %s | esperado: %s\n' "$test_id" "$scenario" "$expected"
    append_result_row "$test_id" "$now" "$request_method" "$request_url" "$scenario" "$expected" "-" "NOT_RUN" "manual_review" "Dry-run only: $scenario"
    return 0
  fi

  local body_file="$TMP_DIR/body-$TOTAL"
  local status
  status="$("$@" -sS --max-time 20 -o "$body_file" -w '%{http_code}' -H "X-WAF-Test-ID: $test_id" 2>"$TMP_DIR/error-$TOTAL" || printf '000')"
  classification="$(result_classification "$status")"
  if [[ "$status" == "000" ]]; then
    result="ERROR"
    notes="curl failed; no HTTP response received"
  elif [[ "$status" == 403 || "$status" == 405 || "$status" == 406 || "$status" == 429 ]]; then
    result="BLOCK_OR_LIMIT"
    notes="WAF/edge protection or rate limit triggered"
  elif [[ "$status" =~ ^2|^3|^4|^5 ]]; then
    result="REVIEW"
    case "$status" in
      2*) notes="request reached origin or an application layer response was returned" ;;
      3*) notes="redirect or forwarding behavior detected" ;;
      4*) notes="client or application error; review in context" ;;
      5*) notes="server-side failure; inspect application or infrastructure" ;;
      *) notes="unexpected HTTP response; review manually" ;;
    esac
  else
    notes="unexpected HTTP code; review manually"
  fi

  printf '%s | HTTP %s | %s | esperado: %s | %s | %s\n' "$test_id" "$status" "$scenario" "$expected" "$result" "$classification"
  append_result_row "$test_id" "$now" "$request_method" "$request_url" "$scenario" "$expected" "$status" "$result" "$classification" "$notes"

  if [[ -s "$TMP_DIR/error-$TOTAL" ]]; then
    sed 's/^/  curl: /' "$TMP_DIR/error-$TOTAL" >&2
  fi
}

request_get() {
  local test_id="$1"
  local expected="$2"
  local url="$3"
  shift 3
  WAF_METHOD="GET"
  local previous_arg=""
  local current_arg
  for current_arg in "$@"; do
    if [[ "$previous_arg" == "-X" ]]; then
      WAF_METHOD="$current_arg"
    fi
    previous_arg="$current_arg"
  done
  WAF_URL="$url"
  run_request "$test_id" "$expected" "$test_id" curl "$@" "$url"
}

request_post_json() {
  local test_id="$1"
  local expected="$2"
  local url="$3"
  local payload="$4"
  shift 4
  WAF_METHOD="POST"
  WAF_URL="$url"
  run_request "$test_id" "$expected" "$test_id" curl -X POST -H 'Content-Type: application/json' --data "$payload" "$@" "$url"
}

json_payload() {
  if command -v jq >/dev/null 2>&1; then
    jq -cn --arg email "$LOGIN_EMAIL" --arg password "$LOGIN_PASSWORD" \
      '{email: $email, password: $password}'
  else
    LOGIN_EMAIL="$LOGIN_EMAIL" LOGIN_PASSWORD="$LOGIN_PASSWORD" node -e \
      'console.log(JSON.stringify({email: process.env.LOGIN_EMAIL, password: process.env.LOGIN_PASSWORD}))'
  fi
}

extract_token() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.token // empty'
  else
    node -e 'const fs=require("fs"); const value=JSON.parse(fs.readFileSync(0,"utf8")); if(value.token) process.stdout.write(value.token);'
  fi
}

obtain_login_token() {
  if [[ -n "$TOKEN" || -z "$LOGIN_EMAIL" ]]; then
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[DRY-RUN] test-15-login-token | login token generation | esperado: token generado\n'
    append_result_row "test-15-login-token" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "POST" "${BASE_URL}/api/auth/login" "login token generation" "Token generado" "-" "NOT_RUN" "manual_review" "Dry-run only: login token generation"
    return 0
  fi
  if [[ -z "$LOGIN_PASSWORD" ]]; then
    printf 'Password para %s (no se mostrara): ' "$LOGIN_EMAIL" >&2
    IFS= read -r -s LOGIN_PASSWORD
    printf '\n' >&2
  fi

  local login_url="${BASE_URL}/api/auth/login"
  local login_body
  local login_status
  login_body="$TMP_DIR/login-response.json"
  login_status="$(curl -sS --max-time 20 -o "$login_body" -w '%{http_code}' \
    -X POST -H 'Content-Type: application/json' \
    -H 'X-WAF-Test-ID: test-15-login-token' \
    --data "$(json_payload)" "$login_url" 2>"$TMP_DIR/login-error" || printf '000')"
  if [[ "$login_status" != "200" ]]; then
    printf 'test-15-login-token | HTTP %s | no fue posible generar el token\n' "$login_status" >&2
    append_result_row "test-15-login-token" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "POST" "$login_url" "login token generation" "Token generado" "$login_status" "ERROR" "connection_failed" "Login attempt failed; token was not returned"
    [[ -s "$TMP_DIR/login-error" ]] && sed 's/^/  curl: /' "$TMP_DIR/login-error" >&2
    return 1
  fi
  TOKEN="$(extract_token < "$login_body")"
  if [[ -z "$TOKEN" ]]; then
    printf 'test-15-login-token | HTTP %s | la respuesta no contiene token\n' "$login_status" >&2
    append_result_row "test-15-login-token" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "POST" "$login_url" "login token generation" "Token generado" "$login_status" "ERROR" "unexpected_status" "Login response arrived but no token field was present"
    return 1
  fi
  printf 'test-15-login-token | HTTP %s | token generado correctamente\n' "$login_status"
  append_result_row "test-15-login-token" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "POST" "$login_url" "login token generation" "Token generado" "$login_status" "PASS" "success" "Auth token created successfully for WAF validation"
}

request_get "test-01-normal-home" "200" "$BASE_URL/"
request_get "test-public-health" "200 with health response" "$BASE_URL/health"
request_get "test-public-auth-bootstrap" "200 with bootstrap response" "$BASE_URL/api/auth/bootstrap-status"
request_get "test-02-sensitive-env" "403 or 404, no content" "$BASE_URL/.env"
request_get "test-03-sensitive-git" "403 or 404, no content" "$BASE_URL/.git/config"
request_get "test-04-server-status" "403 or 404, no diagnostics" "$BASE_URL/server-status"
request_get "test-05-traversal-path" "Detected in Monitoring" "$BASE_URL/../../etc/passwd" --path-as-is
request_get "test-06-traversal-parameter" "Detected in Monitoring" "$BASE_URL/" -G --data-urlencode 'file=../../../../etc/passwd'
request_get "test-07-sqli-query" "Detected in Monitoring" "$BASE_URL/" -G --data-urlencode "search=' OR '1'='1"
request_get "test-08-sqli-union" "Detected in Monitoring" "$BASE_URL/" -G --data-urlencode 'id=1 UNION SELECT 1'
request_get "test-09-xss-script" "Detected in Monitoring" "$BASE_URL/" -G --data-urlencode 'q=<script>alert(1)</script>'
request_get "test-10-xss-attribute" "Detected in Monitoring" "$BASE_URL/" -G --data-urlencode 'q=" onmouseover="alert(1)'
request_get "test-11-trace" "405 or WAF event" "$BASE_URL/" -X TRACE
request_get "test-12-delete" "405 or WAF event" "$BASE_URL/" -X DELETE
request_get "test-13-options" "Configured response" "$BASE_URL/" -X OPTIONS
request_get "test-14-tool-user-agent" "Policy-dependent" "$BASE_URL/" -A 'waf-validation-test'

if [[ -n "$LOGIN_EMAIL" ]]; then
  obtain_login_token || exit 1
fi

if [[ -n "$API_PATH" ]]; then
  API_URL="${BASE_URL}${API_PATH}"
  if [[ -n "$TOKEN" ]]; then
    request_get "test-16-api-sqli" "Detected in Monitoring" "$API_URL" -H "Authorization: Bearer $TOKEN" -G --data-urlencode "search=' OR '1'='1"
    request_get "test-17-api-xss" "Detected in Monitoring" "$API_URL" -H "Authorization: Bearer $TOKEN" -G --data-urlencode 'q=<script>alert(1)</script>'
  else
    request_get "test-16-api-sqli" "Detected in Monitoring" "$API_URL" -G --data-urlencode "search=' OR '1'='1"
    request_get "test-17-api-xss" "Detected in Monitoring" "$API_URL" -G --data-urlencode 'q=<script>alert(1)</script>'
  fi
fi

if [[ -n "$API_POST_PATH" ]]; then
  API_POST_URL="${BASE_URL}${API_POST_PATH}"
  SQLI_JSON_PAYLOAD='{"search":"\u0027 OR \u00271\u0027=\u00271"}'
  if [[ -n "$TOKEN" ]]; then
    request_post_json "test-18-api-json-sqli" "Detected in Monitoring" "$API_POST_URL" "$SQLI_JSON_PAYLOAD" -H "Authorization: Bearer $TOKEN"
    request_post_json "test-19-api-json-xss" "Detected in Monitoring" "$API_POST_URL" '{"name":"<script>alert(1)</script>"}' -H "Authorization: Bearer $TOKEN"
  else
    request_post_json "test-18-api-json-sqli" "Detected in Monitoring" "$API_POST_URL" "$SQLI_JSON_PAYLOAD"
    request_post_json "test-19-api-json-xss" "Detected in Monitoring" "$API_POST_URL" '{"name":"<script>alert(1)</script>"}'
  fi
fi

if [[ -n "$TOKEN" && -n "$API_PATH" ]]; then
  WAF_METHOD="GET"
  WAF_URL="${BASE_URL}${API_PATH}"
    run_request "test-20-api-authenticated" "Allowed without WAF detection" "authenticated API access" curl -H "Authorization: Bearer $TOKEN" "$BASE_URL$API_PATH"
else
  printf '[SKIP] test-20-api-authenticated: requiere --api-path y --token\n'
fi

if [[ "$INCLUDE_RATE_LIMIT" -eq 1 ]]; then
  printf '\nRate limiting: %s solicitudes con %ss entre cada una.\n' "$RATE_LIMIT_REQUESTS" "$RATE_LIMIT_DELAY"
  for request_number in $(seq 1 "$RATE_LIMIT_REQUESTS"); do
    request_get "test-21-rate-limit-$request_number" "Configured threshold" "$BASE_URL/"
    if [[ "$request_number" -lt "$RATE_LIMIT_REQUESTS" ]]; then
      sleep "$RATE_LIMIT_DELAY"
    fi
  done
else
  printf '[SKIP] rate limiting: usa --rate-limit para habilitar una prueba corta\n'
fi

if [[ -n "$ORIGIN_IP" ]]; then
  WAF_METHOD="GET"
  WAF_URL="$BASE_URL/"
  run_request "test-22-origin-bypass" "Origin must not be Internet-accessible" "origin bypass check" curl --connect-to "$HOSTNAME:443:$ORIGIN_IP:443" "$BASE_URL/"
else
  printf '[SKIP] test-21-origin-bypass: requiere --origin-ip IP_DE_LA_VM\n'
fi

printf '\nResultados guardados en: %s\n' "$OUTPUT_FILE"
printf 'Total de solicitudes ejecutadas o simuladas: %s\n' "$TOTAL"
printf 'Recuerda correlacionar cada test_id y timestamp con los eventos de F5 DCS.\n'
