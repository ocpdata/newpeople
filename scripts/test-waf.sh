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
XC_API_URL="${XC_API_URL:-}"
XC_API_P12_FILE="${XC_API_P12_FILE:-}"
XC_P12_PASSWORD="${XC_P12_PASSWORD:-}"
XC_NAMESPACE="${XC_NAMESPACE:-}"
XC_LB_NAME="${XC_LB_NAME:-}"
XC_SECURITY_EVENTS_PATH="${XC_SECURITY_EVENTS_PATH:-}"
XC_WAF_MODE="${XC_WAF_MODE:-monitoring}"
XC_EVENT_WAIT_SECONDS="${XC_EVENT_WAIT_SECONDS:-15}"
XC_EVENT_RETRIES="${XC_EVENT_RETRIES:-4}"
XC_EVENTS_FILE="${XC_EVENTS_FILE:-}"
SKIP_F5=0

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
  --skip-f5            No consulta F5 aunque existan variables XC_API_*
  --f5-events-file F   Usa eventos JSON locales en vez de consultar F5
  -h, --help           Muestra esta ayuda

Variables equivalentes: BASE_URL, API_PATH, API_POST_PATH, TOKEN,
WAF_LOGIN_EMAIL, WAF_LOGIN_PASSWORD, ORIGIN_IP y WAF_TEST_OUTPUT.
Integracion F5: XC_API_URL, XC_API_P12_FILE, XC_P12_PASSWORD, XC_NAMESPACE,
XC_LB_NAME. Opcionales: XC_SECURITY_EVENTS_PATH, XC_WAF_MODE,
XC_EVENT_WAIT_SECONDS, XC_EVENT_RETRIES y XC_EVENTS_FILE.
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
    --skip-f5)
      SKIP_F5=1
      shift
      ;;
    --f5-events-file)
      XC_EVENTS_FILE="${2:?Falta el valor de --f5-events-file}"
      shift 2
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

case "$XC_WAF_MODE" in
  monitoring|blocking) ;;
  *) echo "XC_WAF_MODE debe ser monitoring o blocking" >&2; exit 2 ;;
esac
if [[ ! "$XC_EVENT_WAIT_SECONDS" =~ ^[0-9]+$ || ! "$XC_EVENT_RETRIES" =~ ^[1-9][0-9]*$ ]]; then
  echo "XC_EVENT_WAIT_SECONDS debe ser entero >= 0 y XC_EVENT_RETRIES entero > 0" >&2
  exit 2
fi

F5_ENABLED=0
if [[ "$SKIP_F5" -eq 0 && -n "$XC_EVENTS_FILE" ]]; then
  F5_ENABLED=1
elif [[ "$SKIP_F5" -eq 0 ]]; then
  F5_VALUES="$XC_API_URL$XC_API_P12_FILE$XC_P12_PASSWORD$XC_NAMESPACE$XC_LB_NAME"
  if [[ -n "$F5_VALUES" ]]; then
    for variable_name in XC_API_URL XC_API_P12_FILE XC_P12_PASSWORD XC_NAMESPACE XC_LB_NAME; do
      eval "variable_value=\${$variable_name}"
      if [[ -z "$variable_value" ]]; then
        echo "Falta la variable requerida $variable_name para consultar F5" >&2
        exit 2
      fi
    done
    F5_ENABLED=1
  fi
fi

HOSTNAME="${BASE_URL#https://}"
HOSTNAME="${HOSTNAME%%/*}"
TMP_DIR="$(mktemp -d)"
RAW_OUTPUT="$TMP_DIR/http-results.tsv"
RUN_ID="waf-$(date -u '+%Y%m%dT%H%M%SZ')-$$"
RUN_STARTED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
RESULTS=0
TOTAL=0

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

printf 'run_id\ttest_id\trequest_started_at\trequest_finished_at\tmethod\turl\tscenario\texpected_behavior\thttp_status\thttp_result\tresult_classification\thttp_notes\n' > "$RAW_OUTPUT"

result_classification() {
  local status="$1"

  case "$status" in
    000) echo 'sin_respuesta' ;;
    200|201|202|204) echo 'exito' ;;
    301|302|304) echo 'redireccion' ;;
    400|401|403|404|405|406|429) echo 'bloqueo_o_limite' ;;
    500|502|503|504) echo 'error_servidor' ;;
    *) echo 'estado_inesperado' ;;
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
  local finished_at="${11:-$utc_ts}"

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$RUN_ID" "$test_id" "$utc_ts" "$finished_at" "$method" "$url" "$scenario" "$expected_behavior" "$http_status" "$result" "$result_classification" "$notes" >> "$RAW_OUTPUT"
}

f5_event_field() {
  local event_file="$1"
  local field_names="$2"

  jq -r --argjson names "$field_names" '
    [.. | objects | to_entries[]
      | select((.key | ascii_downcase) as $key | $names | index($key))
      | .value
      | select(type == "string" or type == "number" or type == "boolean")
      | tostring][0] // ""
  ' "$event_file"
}

find_f5_event() {
  local events_file="$1"
  local test_id="$2"
  local event_file="$3"
  local match_mode_file="$4"

  if jq -e --arg run_id "$RUN_ID" --arg test_id "$test_id" '
    first(.. | arrays | .[] | objects
      | select((tojson | contains($run_id)) and (tojson | contains($test_id)))) // empty
  ' "$events_file" > "$event_file"; then
    printf 'run_id_and_test_id' > "$match_mode_file"
    return 0
  fi
  if jq -e --arg test_id "$test_id" '
    first(.. | arrays | .[] | objects | select(tojson | contains($test_id))) // empty
  ' "$events_file" > "$event_file"; then
    printf 'test_id_in_run_window' > "$match_mode_file"
    return 0
  fi
  return 1
}

expected_attack_category() {
  case "$1" in
    test-05-*|test-06-*) printf 'traversal|file inclusion|lfi' ;;
    test-07-*|test-08-*|test-16-*|test-18-*) printf 'sql' ;;
    test-09-*|test-10-*|test-17-*|test-19-*) printf 'xss|cross.site' ;;
    *) printf '' ;;
  esac
}

evaluate_final_result() {
  local test_id="$1"
  local http_status="$2"
  local event_found="$3"
  local event_action="$4"
  local event_category="$5"
  local event_signature="$6"
  local f5_state="$7"
  local expected_category
  local event_text

  if [[ "$http_status" == "000" ]]; then
    [[ "$test_id" == test-22-* ]] && printf 'PASS' || printf 'ERROR'
    return
  fi
  if [[ "$f5_state" == "ERROR" ]]; then
    printf 'ERROR'
    return
  fi
  if [[ "$f5_state" == "SKIPPED" ]]; then
    [[ "$DRY_RUN" -eq 1 ]] && printf 'NOT_RUN' || printf 'INCONCLUSIVE'
    return
  fi

  expected_category="$(expected_attack_category "$test_id")"
  if [[ -n "$expected_category" ]]; then
    if [[ "$event_found" -ne 1 ]]; then
      printf 'FAIL'
      return
    fi
    event_text="$(printf '%s %s' "$event_category" "$event_signature" | tr '[:upper:]' '[:lower:]')"
    if ! printf '%s' "$event_text" | grep -Eq "$expected_category"; then
      printf 'FAIL'
      return
    fi
    if [[ "$XC_WAF_MODE" == "blocking" ]]; then
      if printf '%s' "$event_action" | tr '[:upper:]' '[:lower:]' | grep -Eq 'block|deny|challenge|rate.?limit'; then
        printf 'PASS'
      else
        printf 'FAIL'
      fi
    else
      printf 'PASS'
    fi
    return
  fi

  case "$test_id" in
    test-01-*|test-public-*|test-15-*|test-20-*)
      if [[ "$event_found" -eq 1 ]]; then printf 'FAIL'; elif [[ "$http_status" =~ ^2 ]]; then printf 'PASS'; else printf 'FAIL'; fi
      ;;
    test-02-*|test-03-*|test-04-*)
      if [[ "$http_status" == 403 || "$http_status" == 404 ]]; then printf 'PASS'; else printf 'INCONCLUSIVE'; fi
      ;;
    test-11-*|test-12-*)
      if [[ "$http_status" == 403 || "$http_status" == 405 || "$event_found" -eq 1 ]]; then printf 'PASS'; else printf 'FAIL'; fi
      ;;
    test-13-*|test-14-*) printf 'INCONCLUSIVE' ;;
    test-21-rate-limit-*)
      if [[ "$http_status" == 429 ]] || printf '%s' "$event_action" | grep -Eqi 'rate.?limit|block'; then printf 'PASS'; else printf 'INCONCLUSIVE'; fi
      ;;
    test-22-*) printf 'FAIL' ;;
    *) printf 'INCONCLUSIVE' ;;
  esac
}

translate_final_result() {
  case "$1" in
    PASS) printf 'PASÓ' ;;
    FAIL) printf 'FALLÓ' ;;
    INCONCLUSIVE) printf 'REVISAR' ;;
    NOT_RUN) printf 'NO EJECUTADA' ;;
    *) printf 'ERROR' ;;
  esac
}

translate_f5_action() {
  local action_lower
  action_lower="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$action_lower" in
    *block*|*deny*) printf 'Bloqueada' ;;
    *detect*) printf 'Detectada' ;;
    *allow*) printf 'Permitida' ;;
    *challenge*) printf 'Desafío aplicado' ;;
    *rate*limit*) printf 'Limitada por frecuencia' ;;
    '') printf 'Sin acción registrada' ;;
    *) printf '%s' "$1" ;;
  esac
}

translate_f5_category() {
  local category_lower
  category_lower="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$category_lower" in
    *sql*injection*) printf 'Inyección SQL' ;;
    *cross*site*|*xss*) printf 'Secuencias de comandos entre sitios (XSS)' ;;
    *traversal*|*file*inclusion*|*lfi*) printf 'Recorrido de rutas o inclusión de archivos' ;;
    '') printf 'Sin categoría registrada' ;;
    *) printf '%s' "$1" ;;
  esac
}

explain_final_result() {
  local test_id="$1"
  local http_status="$2"
  local event_found="$3"
  local event_action="$4"
  local event_category="$5"
  local final_result="$6"
  local f5_state="$7"
  local expected_category

  if [[ "$final_result" == "ERROR" ]]; then
    if [[ "$http_status" == "000" ]]; then
      printf 'No se recibió respuesta HTTP del sitio.'
    else
      printf 'No fue posible consultar o interpretar los eventos de F5.'
    fi
    return
  fi
  if [[ "$final_result" == "NOT_RUN" ]]; then
    printf 'La prueba fue simulada; no se envió ninguna solicitud.'
    return
  fi
  if [[ "$f5_state" == "SKIPPED" ]]; then
    printf 'La solicitud respondió HTTP %s, pero F5 no fue consultado.' "$http_status"
    return
  fi

  expected_category="$(expected_attack_category "$test_id")"
  if [[ -n "$expected_category" ]]; then
    if [[ "$event_found" -ne 1 ]]; then
      printf 'F5 no registró la detección de ataque esperada.'
    elif [[ "$final_result" == "FAIL" ]]; then
      printf 'F5 registró un evento, pero su categoría o acción no coincide con lo esperado.'
    elif [[ "$XC_WAF_MODE" == "blocking" ]]; then
      printf 'F5 detectó el ataque y aplicó la acción %s.' "$(translate_f5_action "$event_action")"
    else
      printf 'F5 detectó correctamente %s en modo monitoreo.' "$(translate_f5_category "$event_category")"
    fi
    return
  fi

  case "$test_id" in
    test-01-*|test-public-*|test-15-*|test-20-*)
      if [[ "$final_result" == "PASS" ]]; then
        printf 'La solicitud legítima respondió HTTP %s sin falso positivo de F5.' "$http_status"
      else
        printf 'La solicitud legítima no tuvo el comportamiento esperado.'
      fi
      ;;
    test-02-*|test-03-*|test-04-*)
      if [[ "$final_result" == "PASS" ]]; then
        printf 'El recurso sensible no fue expuesto; respondió HTTP %s.' "$http_status"
      else
        printf 'Respondió HTTP %s; revisa que sea el HTML de la aplicación y no contenido sensible.' "$http_status"
      fi
      ;;
    test-11-*|test-12-*) printf 'El método HTTP fue rechazado o detectado por F5.' ;;
    test-13-*) printf 'Revisa manualmente que la respuesta OPTIONS coincida con la política CORS.' ;;
    test-14-*) printf 'El resultado depende de la política configurada para herramientas automatizadas.' ;;
    test-21-rate-limit-*) printf 'Revisa el conjunto completo para confirmar cuándo se aplicó el límite.' ;;
    test-22-*) printf 'El origen respondió directamente y puede evitar F5.' ;;
    *) printf 'Revisa la respuesta HTTP y el evento F5 asociado.' ;;
  esac
}

fetch_f5_events() {
  local destination="$1"
  local run_finished_at="$2"
  local request_body="$TMP_DIR/f5-request.json"
  local curl_config="$TMP_DIR/f5-curl.conf"
  local response_status
  local events_path="$XC_SECURITY_EVENTS_PATH"
  local start_epoch
  local end_epoch
  local query

  if [[ -n "$XC_EVENTS_FILE" ]]; then
    [[ -r "$XC_EVENTS_FILE" ]] || { echo "No se puede leer XC_EVENTS_FILE: $XC_EVENTS_FILE" >&2; return 1; }
    jq empty "$XC_EVENTS_FILE" || return 1
    cp "$XC_EVENTS_FILE" "$destination"
  else
    command -v jq >/dev/null 2>&1 || { echo "La integracion F5 requiere jq" >&2; return 1; }
    [[ -r "$XC_API_P12_FILE" ]] || { echo "No se puede leer XC_API_P12_FILE: $XC_API_P12_FILE" >&2; return 1; }
    [[ -n "$events_path" ]] || events_path="/api/data/namespaces/$XC_NAMESPACE/app_security/events"

    start_epoch="$(jq -nr --arg timestamp "$RUN_STARTED_AT" '$timestamp | fromdateiso8601')" || return 1
    end_epoch="$(jq -nr --arg timestamp "$run_finished_at" '$timestamp | fromdateiso8601')" || return 1
    query="{vh_name=\"ves-io-http-loadbalancer-$XC_LB_NAME\",sec_event_type=~\"waf_sec_event|bot_defense_sec_event|api_sec_event|svc_policy_sec_event\"}"

    jq -n \
      --arg namespace "$XC_NAMESPACE" \
      --arg query "$query" \
      --arg start_time "$start_epoch" \
      --arg end_time "$end_epoch" \
      '{aggs: {}, end_time: $end_time, limit: 0, namespace: $namespace, query: $query, sort: "DESCENDING", start_time: $start_time, scroll: true}' > "$request_body"
    printf 'cert = %s\ncert-type = "P12"\npass = %s\n' \
      "$(jq -Rn --arg value "$XC_API_P12_FILE" '$value')" \
      "$(jq -Rn --arg value "$XC_P12_PASSWORD" '$value')" > "$curl_config"
    chmod 600 "$curl_config"
    response_status="$(curl -sS --config "$curl_config" --max-time 30 \
      -o "$destination" -w '%{http_code}' -X POST \
      -H 'Content-Type: application/json' --data-binary "@$request_body" \
      "${XC_API_URL%/}$events_path" 2>"$TMP_DIR/f5-error" || printf '000')"
    if [[ ! "$response_status" =~ ^2 ]]; then
      printf 'F5 API respondio HTTP %s' "$response_status" >&2
      [[ -s "$TMP_DIR/f5-error" ]] && sed 's/^/: /' "$TMP_DIR/f5-error" >&2
      if jq -e . "$destination" >/dev/null 2>&1; then
        printf ': %s' "$(jq -c '{code, message, details, error} | with_entries(select(.value != null))' "$destination")" >&2
      elif [[ -s "$destination" ]]; then
        printf ': %s' "$(head -c 500 "$destination")" >&2
      fi
      printf '\n' >&2
      [[ "$response_status" =~ ^4 && "$response_status" != 408 && "$response_status" != 429 ]] && return 2
      return 1
    fi
    jq empty "$destination" || { echo "F5 API no devolvio JSON valido" >&2; return 1; }
  fi
  jq '.events = [(.events // [])[] | if type == "string" then fromjson else . end]' "$destination" > "$TMP_DIR/f5-normalized.json" || {
    echo "F5 API devolvio un evento que no contiene JSON valido" >&2
    return 1
  }
  mv "$TMP_DIR/f5-normalized.json" "$destination"
}

write_final_output() {
  local events_file="$1"
  local f5_state="$2"
  local f5_error="${3:-}"
  local event_file="$TMP_DIR/matched-event.json"
  local match_mode_file="$TMP_DIR/match-mode"

  printf 'resultado\tprueba\tque_se_esperaba\tque_ocurrio\thttp\tevento_f5\taccion_f5\tcategoria_f5\tfirma_f5_original\tconfianza_correlacion\tmetodo\turl\tfecha_utc\tid_evento_f5\tid_solicitud_f5\trun_id\n' > "$OUTPUT_FILE"
  tail -n +2 "$RAW_OUTPUT" | while IFS=$'\t' read -r run_id test_id started_at finished_at method url scenario expected http_status http_result classification http_notes; do
    local event_found=0
    local event_id=""
    local request_id=""
    local category=""
    local signature=""
    local action=""
    local event_timestamp=""
    local correlation_method=""
    local confidence="none"
    local final_result
    local displayed_result
    local displayed_action
    local displayed_category
    local displayed_confidence
    local event_status
    local explanation
    local final_notes="$f5_error"

    if [[ "$f5_state" == "QUERIED" ]] && find_f5_event "$events_file" "$test_id" "$event_file" "$match_mode_file"; then
      event_found=1
      correlation_method="$(cat "$match_mode_file")"
      [[ "$correlation_method" == "run_id_and_test_id" ]] && confidence="high" || confidence="medium"
      event_id="$(f5_event_field "$event_file" '["event_id","id","uid"]')"
      request_id="$(f5_event_field "$event_file" '["request_id","req_id","correlation_id"]')"
      category="$(f5_event_field "$event_file" '["category","attack_type","threat_type","violation_type"]')"
      signature="$(f5_event_field "$event_file" '["signature","signature_name","attack_name","rule_name"]')"
      action="$(f5_event_field "$event_file" '["action","enforcement_action","waf_action"]')"
      event_timestamp="$(f5_event_field "$event_file" '["timestamp","time","event_time","created_at"]')"
      final_notes="Evento F5 correlacionado mediante $correlation_method"
    elif [[ "$f5_state" == "QUERIED" ]]; then
      correlation_method="not_found_in_run_window"
      final_notes="No se encontro un evento F5 despues de los reintentos"
    elif [[ "$f5_state" == "SKIPPED" ]]; then
      final_notes="Validacion F5 omitida o no configurada"
    fi

    final_result="$(evaluate_final_result "$test_id" "$http_status" "$event_found" "$action" "$category" "$signature" "$f5_state")"
    displayed_result="$(translate_final_result "$final_result")"
    displayed_action="$(translate_f5_action "$action")"
    displayed_category="$(translate_f5_category "$category")"
    case "$confidence" in
      high) displayed_confidence="Alta" ;;
      medium) displayed_confidence="Media" ;;
      *) displayed_confidence="Ninguna" ;;
    esac
    if [[ "$f5_state" == "ERROR" ]]; then
      event_status="Error al consultar"
    elif [[ "$f5_state" == "SKIPPED" ]]; then
      event_status="No consultado"
    elif [[ "$event_found" -eq 1 ]]; then
      event_status="Sí"
    else
      event_status="No"
    fi
    explanation="$(explain_final_result "$test_id" "$http_status" "$event_found" "$action" "$category" "$final_result" "$f5_state")"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$displayed_result" "$test_id" "$expected" "$explanation" "$http_status" "$event_status" "$displayed_action" "$displayed_category" \
      "$signature" "$displayed_confidence" "$method" "$url" "$started_at" "$event_id" "$request_id" "$run_id" >> "$OUTPUT_FILE"
  done
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
  shift 3
  TOTAL=$((TOTAL + 1))
  local now
  now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local request_method="${WAF_METHOD:-GET}"
  local request_url="${WAF_URL:-N/A}"
  local result="REVISAR"
  local classification
  local notes

  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[DRY-RUN] %s | %s | esperado: %s\n' "$test_id" "$scenario" "$expected"
    append_result_row "$test_id" "$now" "$request_method" "$request_url" "$scenario" "$expected" "-" "NOT_RUN" "manual_review" "Dry-run only: $scenario"
    return 0
  fi

  local body_file="$TMP_DIR/body-$TOTAL"
  local status
  local curl_result
  local finished_at
  curl_result="$("$@" -sS --max-time 20 -o "$body_file" -w $'%{http_code}\t%{url_effective}' \
    -H "X-WAF-Test-ID: $test_id" -H "X-WAF-Run-ID: $RUN_ID" 2>"$TMP_DIR/error-$TOTAL" || printf '000')"
  status="${curl_result%%$'\t'*}"
  if [[ "$curl_result" == *$'\t'* ]]; then
    request_url="${curl_result#*$'\t'}"
  fi
  finished_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  classification="$(result_classification "$status")"
  if [[ "$status" == "000" ]]; then
    result="ERROR"
    notes="curl fallo; no se recibio una respuesta HTTP"
  elif [[ "$status" == 403 || "$status" == 405 || "$status" == 406 || "$status" == 429 ]]; then
    result="BLOQUEO_O_LIMITE"
    notes="se activo una proteccion perimetral o limite de frecuencia"
  elif [[ "$status" =~ ^2|^3|^4|^5 ]]; then
    result="REVISAR"
    case "$status" in
      2*) notes="la solicitud llego al origen o respondio la aplicacion" ;;
      3*) notes="se detecto una redireccion" ;;
      4*) notes="error de cliente o aplicacion; revisar en contexto" ;;
      5*) notes="error del servidor; revisar aplicacion o infraestructura" ;;
      *) notes="respuesta HTTP inesperada; revisar manualmente" ;;
    esac
  else
    notes="codigo HTTP inesperado; revisar manualmente"
  fi

  printf '%s | HTTP %s | %s | esperado: %s | %s | %s\n' "$test_id" "$status" "$scenario" "$expected" "$result" "$classification"
  append_result_row "$test_id" "$now" "$request_method" "$request_url" "$scenario" "$expected" "$status" "$result" "$classification" "$notes" "$finished_at"

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
    -H "X-WAF-Run-ID: $RUN_ID" \
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
request_get "test-public-health" "Respuesta de salud HTTP 200" "$BASE_URL/health"
request_get "test-public-auth-bootstrap" "Respuesta de inicio HTTP 200" "$BASE_URL/api/auth/bootstrap-status"
request_get "test-02-sensitive-env" "HTTP 403 o 404, sin contenido sensible" "$BASE_URL/.env"
request_get "test-03-sensitive-git" "HTTP 403 o 404, sin contenido sensible" "$BASE_URL/.git/config"
request_get "test-04-server-status" "HTTP 403 o 404, sin diagnosticos" "$BASE_URL/server-status"
request_get "test-05-traversal-path" "Deteccion de ataque por F5" "$BASE_URL/../../etc/passwd" --path-as-is
request_get "test-06-traversal-parameter" "Deteccion de ataque por F5" "$BASE_URL/" -G --data-urlencode 'file=../../../../etc/passwd'
request_get "test-07-sqli-query" "Deteccion de ataque por F5" "$BASE_URL/" -G --data-urlencode "search=' OR '1'='1"
request_get "test-08-sqli-union" "Deteccion de ataque por F5" "$BASE_URL/" -G --data-urlencode 'id=1 UNION SELECT 1'
request_get "test-09-xss-script" "Deteccion de ataque por F5" "$BASE_URL/" -G --data-urlencode 'q=<script>alert(1)</script>'
request_get "test-10-xss-attribute" "Deteccion de ataque por F5" "$BASE_URL/" -G --data-urlencode 'q=" onmouseover="alert(1)'
request_get "test-11-trace" "HTTP 405 o evento F5" "$BASE_URL/" -X TRACE
request_get "test-12-delete" "HTTP 405 o evento F5" "$BASE_URL/" -X DELETE
request_get "test-13-options" "Respuesta acorde con la configuracion" "$BASE_URL/" -X OPTIONS
request_get "test-14-tool-user-agent" "Resultado segun la politica configurada" "$BASE_URL/" -A 'waf-validation-test'

if [[ -n "$LOGIN_EMAIL" ]]; then
  obtain_login_token || exit 1
fi

if [[ -n "$API_PATH" ]]; then
  API_URL="${BASE_URL}${API_PATH}"
  if [[ -n "$TOKEN" ]]; then
    request_get "test-16-api-sqli" "Deteccion de ataque por F5" "$API_URL" -H "Authorization: Bearer $TOKEN" -G --data-urlencode "search=' OR '1'='1"
    request_get "test-17-api-xss" "Deteccion de ataque por F5" "$API_URL" -H "Authorization: Bearer $TOKEN" -G --data-urlencode 'q=<script>alert(1)</script>'
  else
    request_get "test-16-api-sqli" "Deteccion de ataque por F5" "$API_URL" -G --data-urlencode "search=' OR '1'='1"
    request_get "test-17-api-xss" "Deteccion de ataque por F5" "$API_URL" -G --data-urlencode 'q=<script>alert(1)</script>'
  fi
fi

if [[ -n "$API_POST_PATH" ]]; then
  API_POST_URL="${BASE_URL}${API_POST_PATH}"
  SQLI_JSON_PAYLOAD='{"search":"\u0027 OR \u00271\u0027=\u00271"}'
  if [[ -n "$TOKEN" ]]; then
    request_post_json "test-18-api-json-sqli" "Deteccion de ataque por F5" "$API_POST_URL" "$SQLI_JSON_PAYLOAD" -H "Authorization: Bearer $TOKEN"
    request_post_json "test-19-api-json-xss" "Deteccion de ataque por F5" "$API_POST_URL" '{"name":"<script>alert(1)</script>"}' -H "Authorization: Bearer $TOKEN"
  else
    request_post_json "test-18-api-json-sqli" "Deteccion de ataque por F5" "$API_POST_URL" "$SQLI_JSON_PAYLOAD"
    request_post_json "test-19-api-json-xss" "Deteccion de ataque por F5" "$API_POST_URL" '{"name":"<script>alert(1)</script>"}'
  fi
fi

if [[ -n "$TOKEN" && -n "$API_PATH" ]]; then
  WAF_METHOD="GET"
  WAF_URL="${BASE_URL}${API_PATH}"
    run_request "test-20-api-authenticated" "Permitida sin deteccion WAF" "acceso autenticado a la API" curl -H "Authorization: Bearer $TOKEN" "$BASE_URL$API_PATH"
else
  printf '[SKIP] test-20-api-authenticated: requiere --api-path y --token\n'
fi

if [[ "$INCLUDE_RATE_LIMIT" -eq 1 ]]; then
  printf '\nRate limiting: %s solicitudes con %ss entre cada una.\n' "$RATE_LIMIT_REQUESTS" "$RATE_LIMIT_DELAY"
  for request_number in $(seq 1 "$RATE_LIMIT_REQUESTS"); do
    request_get "test-21-rate-limit-$request_number" "Umbral configurado" "$BASE_URL/"
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
  run_request "test-22-origin-bypass" "El origen no debe ser accesible desde Internet" "prueba de acceso directo al origen" curl --connect-to "$HOSTNAME:443:$ORIGIN_IP:443" "$BASE_URL/"
else
  printf '[SKIP] test-21-origin-bypass: requiere --origin-ip IP_DE_LA_VM\n'
fi

RUN_FINISHED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
F5_STATE="SKIPPED"
F5_ERROR=""
F5_EVENTS_FILE="$TMP_DIR/f5-events.json"
if [[ "$F5_ENABLED" -eq 1 && "$DRY_RUN" -eq 0 ]]; then
  F5_STATE="ERROR"
  attempt=1
  while [[ "$attempt" -le "$XC_EVENT_RETRIES" ]]; do
    if fetch_f5_events "$F5_EVENTS_FILE" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"; then
      F5_STATE="QUERIED"
      if [[ -n "$XC_EVENTS_FILE" ]] || jq -e --arg run_id "$RUN_ID" --arg test_prefix 'test-' \
        'any(.. | strings; contains($run_id) or contains($test_prefix))' "$F5_EVENTS_FILE" >/dev/null; then
        break
      fi
    else
      fetch_code=$?
      F5_ERROR="F5 events query failed"
      if [[ "$fetch_code" -eq 2 ]]; then
        break
      fi
    fi
    if [[ "$attempt" -lt "$XC_EVENT_RETRIES" ]]; then
      printf 'F5 aun no tiene eventos correlacionables; reintento %s de %s en %ss\n' \
        "$((attempt + 1))" "$XC_EVENT_RETRIES" "$XC_EVENT_WAIT_SECONDS" >&2
      sleep "$XC_EVENT_WAIT_SECONDS"
    fi
    attempt=$((attempt + 1))
  done
fi

write_final_output "$F5_EVENTS_FILE" "$F5_STATE" "$F5_ERROR"

printf '\nResultados guardados en: %s\n' "$OUTPUT_FILE"
printf 'Total de solicitudes ejecutadas o simuladas: %s\n' "$TOTAL"
if [[ "$F5_STATE" == "QUERIED" ]]; then
  printf 'Resultados correlacionados con eventos de F5 DCS (%s).\n' "$XC_WAF_MODE"
elif [[ "$F5_STATE" == "ERROR" ]]; then
  printf 'No fue posible consultar F5 DCS; revisa final_result=ERROR.\n' >&2
else
  printf 'F5 DCS no configurado; revisa final_result=INCONCLUSIVE.\n'
fi
