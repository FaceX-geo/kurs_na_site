#!/usr/bin/env bash
set -euo pipefail

: "${TARGET_ENVIRONMENT:?TARGET_ENVIRONMENT is required}"
: "${DEPLOY_HOST:?DEPLOY_HOST environment variable is required}"
: "${DEPLOY_USER:?DEPLOY_USER environment variable is required}"
: "${DEPLOY_PORT:?DEPLOY_PORT environment variable is required}"
: "${DEPLOY_STACK_NAME:?DEPLOY_STACK_NAME environment variable is required}"
: "${DEPLOY_SSH_PRIVATE_KEY:?DEPLOY_SSH_PRIVATE_KEY secret is required}"

sync_env_only="${SYNC_ENV_ONLY:-false}"
services_raw="${DEPLOY_SERVICE_NAMES:-${DEPLOY_STACK_NAME}_app}"
deploy_apps_root="${DEPLOY_APPS_ROOT:-/opt/facex/apps}"
docker_build_context="${DOCKER_BUILD_CONTEXT:-.}"
dockerfile="${DOCKERFILE:-Dockerfile}"
deploy_update_strategy="${DEPLOY_UPDATE_STRATEGY:-stack}"

case "${TARGET_ENVIRONMENT}" in
  staging|production) ;;
  *)
    echo "Invalid target environment: ${TARGET_ENVIRONMENT}" >&2
    exit 1
    ;;
esac
case "${sync_env_only}" in
  true|false) ;;
  *)
    echo "SYNC_ENV_ONLY must be true or false: ${sync_env_only}" >&2
    exit 1
    ;;
esac
case "${deploy_update_strategy}" in
  stack|service) ;;
  *)
    echo "DEPLOY_UPDATE_STRATEGY must be stack or service: ${deploy_update_strategy}" >&2
    exit 1
    ;;
esac
if [[ ! "${DEPLOY_STACK_NAME}" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "Invalid DEPLOY_STACK_NAME: ${DEPLOY_STACK_NAME}" >&2
  exit 1
fi
if [[ ! "${DEPLOY_USER}" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  echo "Invalid DEPLOY_USER: ${DEPLOY_USER}" >&2
  exit 1
fi
if [[ ! "${DEPLOY_PORT}" =~ ^[0-9]+$ ]] || [ "${DEPLOY_PORT}" -lt 1 ] || [ "${DEPLOY_PORT}" -gt 65535 ]; then
  echo "Invalid DEPLOY_PORT: ${DEPLOY_PORT}" >&2
  exit 1
fi
if [[ ! "${deploy_apps_root}" =~ ^/[A-Za-z0-9_./-]+$ ]]; then
  echo "Invalid DEPLOY_APPS_ROOT: ${deploy_apps_root}" >&2
  exit 1
fi
validate_relative_path() {
  local value="$1"
  [ -n "$value" ] || return 1
  [[ "$value" != /* ]] || return 1
  [[ "$value" != *..* ]] || return 1
  [[ "$value" =~ ^[A-Za-z0-9_./-]+$ ]] || return 1
}
if ! validate_relative_path "${docker_build_context}"; then
  echo "Invalid DOCKER_BUILD_CONTEXT: ${docker_build_context}" >&2
  exit 1
fi
if ! validate_relative_path "${dockerfile}"; then
  echo "Invalid DOCKERFILE: ${dockerfile}" >&2
  exit 1
fi
if [ -n "${SMOKE_HOST_HEADER:-}" ] && [[ ! "${SMOKE_HOST_HEADER}" =~ ^[A-Za-z0-9_.:-]+$ ]]; then
  echo "Invalid SMOKE_HOST_HEADER: ${SMOKE_HOST_HEADER}" >&2
  exit 1
fi
if [ -n "${SMOKE_RESOLVE:-}" ] && [[ ! "${SMOKE_RESOLVE}" =~ ^[A-Za-z0-9_.:-]+$ ]]; then
  echo "Invalid SMOKE_RESOLVE: ${SMOKE_RESOLVE}" >&2
  exit 1
fi
case "${SMOKE_INSECURE:-false}" in
  true|false) ;;
  *)
    echo "SMOKE_INSECURE must be true or false." >&2
    exit 1
    ;;
esac

service_names=()
while IFS= read -r service; do
  [ -n "$service" ] || continue
  if [[ ! "$service" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    echo "Invalid Docker service name: $service" >&2
    exit 1
  fi
  service_names+=("$service")
done < <(printf '%s\n' "$services_raw" | tr ', ' '\n\n')
if [ "${#service_names[@]}" -eq 0 ]; then
  echo "No Docker services configured for deploy." >&2
  exit 1
fi

if [ "${sync_env_only}" != "true" ]; then
  : "${GITHUB_SHA:?GITHUB_SHA is required}"
  if [[ ! "${GITHUB_SHA}" =~ ^[A-Fa-f0-9]{7,64}$ ]]; then
    echo "Invalid GITHUB_SHA: ${GITHUB_SHA}" >&2
    exit 1
  fi
  if [ ! -s app-source.tgz ]; then
    echo "app-source.tgz is missing; create it with git archive before deploy." >&2
    exit 1
  fi
fi

mkdir -p ~/.ssh
install -m 600 /dev/null ~/.ssh/deploy_key
printf '%s\n' "${DEPLOY_SSH_PRIVATE_KEY}" > ~/.ssh/deploy_key
ssh_connect_timeout="${SSH_CONNECT_TIMEOUT_SECONDS:-20}"
if [[ ! "${ssh_connect_timeout}" =~ ^[0-9]+$ ]] || [ "${ssh_connect_timeout}" -lt 5 ]; then
  echo "SSH_CONNECT_TIMEOUT_SECONDS must be an integer >= 5." >&2
  exit 1
fi
remote_command_timeout="${DEPLOY_COMMAND_TIMEOUT_SECONDS:-900}"
if [[ ! "${remote_command_timeout}" =~ ^[0-9]+$ ]] || [ "${remote_command_timeout}" -lt 60 ]; then
  echo "DEPLOY_COMMAND_TIMEOUT_SECONDS must be an integer >= 60." >&2
  exit 1
fi
run_with_timeout() {
  local seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "${seconds}s" "$@"
  else
    "$@"
  fi
}
echo "Connecting to ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PORT}."
run_with_timeout "${ssh_connect_timeout}" ssh-keyscan -T "${ssh_connect_timeout}" -p "${DEPLOY_PORT}" "${DEPLOY_HOST}" >> ~/.ssh/known_hosts
ssh_target="${DEPLOY_USER}@${DEPLOY_HOST}"
ssh_opts=(
  -i ~/.ssh/deploy_key
  -p "${DEPLOY_PORT}"
  -o BatchMode=yes
  -o ConnectTimeout="${ssh_connect_timeout}"
  -o ConnectionAttempts=1
  -o StrictHostKeyChecking=yes
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=20
)
scp_opts=(
  -i ~/.ssh/deploy_key
  -P "${DEPLOY_PORT}"
  -o BatchMode=yes
  -o ConnectTimeout="${ssh_connect_timeout}"
  -o ConnectionAttempts=1
  -o StrictHostKeyChecking=yes
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=20
)

case "${TARGET_ENVIRONMENT}" in
  staging)
    default_env_file_name=".env.staging"
    ;;
  production)
    default_env_file_name=".env.production"
    ;;
esac

if [ -n "${STAGING_ENV_FILE:-}" ] || [ -n "${PRODUCTION_ENV_FILE:-}" ]; then
  echo "STAGING_ENV_FILE/PRODUCTION_ENV_FILE are deprecated. Use individual repository variables/secrets rendered through APP_ENV_OVERRIDES." >&2
  exit 1
fi

app_env_overrides="${APP_ENV_OVERRIDES:-}"
app_env_file_name="${DEPLOY_APP_ENV_FILE_NAME:-${default_env_file_name}}"
env_file_uploaded="false"
if [ -n "${app_env_overrides:-}" ]; then
  if [[ ! "${app_env_file_name}" =~ ^\.env\.(staging|production|local)$ ]]; then
    echo "DEPLOY_APP_ENV_FILE_NAME must be .env.staging, .env.production, or .env.local when an env file secret is set." >&2
    exit 1
  fi
  if [ -n "${app_env_overrides:-}" ]; then
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      if [[ ! "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
        echo "Invalid APP_ENV_OVERRIDES line; expected KEY=VALUE." >&2
        exit 1
      fi
    done <<< "${app_env_overrides}"
  fi
  install -m 600 /dev/null app.env
  printf '%s\n' "${app_env_overrides}" > app.env
  remote_tmp="/tmp/${DEPLOY_STACK_NAME}.${app_env_file_name}.tmp"
  run_with_timeout "${remote_command_timeout}" scp "${scp_opts[@]}" app.env "${ssh_target}:${remote_tmp}"
  rm -f app.env
  run_with_timeout "${remote_command_timeout}" ssh "${ssh_opts[@]}" "${ssh_target}" "bash -s" -- "${deploy_apps_root}" "${DEPLOY_STACK_NAME}" "${DEPLOY_USER}" "${remote_tmp}" "${app_env_file_name}" <<'REMOTE_ENV'
set -euo pipefail
deploy_apps_root="$1"
stack="$2"
deploy_user="$3"
remote_tmp="$4"
app_env_file_name="$5"
app_dir="${deploy_apps_root}/${stack}"
sudo install -d -o "$deploy_user" -g "$deploy_user" -m 700 "$app_dir"
if [ ! -d "$app_dir" ]; then
  echo "App directory does not exist: $app_dir. Run infra-as-code first to create the stack directory." >&2
  rm -f "$remote_tmp"
  exit 1
fi
if [ ! -w "$app_dir" ]; then
  echo "App directory is not writable by $deploy_user: $app_dir" >&2
  rm -f "$remote_tmp"
  exit 1
fi
chmod 700 "$app_dir" 2>/dev/null || true
backup_marker="${app_dir}/.last-env-backup-${app_env_file_name#.}"
target_file="${app_dir}/${app_env_file_name}"
if [ -f "$target_file" ]; then
  backup_dir="${app_dir}/backups/env"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  install -d -m 700 "$backup_dir"
  backup_file="${backup_dir}/${app_env_file_name}.${timestamp}"
  cp -p "$target_file" "$backup_file"
  printf '%s\n' "$backup_file" > "$backup_marker"
else
  printf '%s\n' "__NONE__" > "$backup_marker"
fi
install -m 600 "$remote_tmp" "$target_file"
rm -f "$remote_tmp"
REMOTE_ENV
  env_file_uploaded="true"
fi

image_ref=""
remote_archive=""
if [ "${sync_env_only}" = "true" ]; then
  echo "Runtime env file sync requested; existing service images will be preserved."
else
  image_stack="$(printf '%s' "${DEPLOY_STACK_NAME}" | tr '[:upper:]' '[:lower:]')"
  image_ref="facex-local/${image_stack}:sha-${GITHUB_SHA}"
  remote_archive="/tmp/${DEPLOY_STACK_NAME}.${GITHUB_SHA}.tgz"
  run_with_timeout "${remote_command_timeout}" scp "${scp_opts[@]}" app-source.tgz "${ssh_target}:${remote_archive}"
fi

encode_remote_arg() {
  if [ -z "${1:-}" ]; then
    printf '__EMPTY__'
  else
    printf '%s' "$1" | base64 | tr -d '\n'
  fi
}
docker_build_args_b64="$(encode_remote_arg "${DOCKER_BUILD_ARGS:-}")"
docker_build_context_b64="$(encode_remote_arg "${docker_build_context}")"
dockerfile_b64="$(encode_remote_arg "${dockerfile}")"
smoke_url_b64="$(encode_remote_arg "${SMOKE_URL:-}")"
smoke_host_header_b64="$(encode_remote_arg "${SMOKE_HOST_HEADER:-}")"
smoke_resolve_b64="$(encode_remote_arg "${SMOKE_RESOLVE:-}")"
smoke_insecure_b64="$(encode_remote_arg "${SMOKE_INSECURE:-false}")"
service_names_b64="$(encode_remote_arg "$(printf '%s\n' "${service_names[@]}")")"
sync_env_only_b64="$(encode_remote_arg "${sync_env_only}")"
app_env_file_name_b64="$(encode_remote_arg "${app_env_file_name}")"
env_file_uploaded_b64="$(encode_remote_arg "${env_file_uploaded}")"
deploy_update_strategy_b64="$(encode_remote_arg "${deploy_update_strategy}")"
sha_arg="${GITHUB_SHA:-__EMPTY__}"
image_ref_arg="${image_ref:-__EMPTY__}"
remote_archive_arg="${remote_archive:-__EMPTY__}"

run_with_timeout "${remote_command_timeout}" ssh "${ssh_opts[@]}" "${ssh_target}" "bash -s" -- \
  "${deploy_apps_root}" \
  "${DEPLOY_STACK_NAME}" \
  "${DEPLOY_USER}" \
  "$sha_arg" \
  "$image_ref_arg" \
  "$remote_archive_arg" \
  "$docker_build_args_b64" \
  "$docker_build_context_b64" \
  "$dockerfile_b64" \
  "$smoke_url_b64" \
  "$smoke_host_header_b64" \
  "$smoke_resolve_b64" \
  "$smoke_insecure_b64" \
  "$service_names_b64" \
  "$sync_env_only_b64" \
  "$app_env_file_name_b64" \
  "$env_file_uploaded_b64" \
  "$deploy_update_strategy_b64" <<'REMOTE_DEPLOY'
set -euo pipefail
deploy_apps_root="$1"
stack="$2"
deploy_user="$3"
sha="$4"
image_ref="$5"
remote_archive="$6"
if [ "$sha" = "__EMPTY__" ]; then
  sha=""
fi
if [ "$image_ref" = "__EMPTY__" ]; then
  image_ref=""
fi
if [ "$remote_archive" = "__EMPTY__" ]; then
  remote_archive=""
fi
decode_remote_arg() {
  if [ "${1:-__EMPTY__}" = "__EMPTY__" ]; then
    printf ''
  else
    printf '%s' "$1" | base64 -d
  fi
}
docker_build_args_raw="$(decode_remote_arg "${7:-__EMPTY__}")"
docker_build_context="$(decode_remote_arg "${8:-__EMPTY__}")"
dockerfile="$(decode_remote_arg "${9:-__EMPTY__}")"
smoke_url="$(decode_remote_arg "${10:-__EMPTY__}")"
smoke_host_header="$(decode_remote_arg "${11:-__EMPTY__}")"
smoke_resolve="$(decode_remote_arg "${12:-__EMPTY__}")"
smoke_insecure="$(decode_remote_arg "${13:-__EMPTY__}")"
service_names_raw="$(decode_remote_arg "${14:-__EMPTY__}")"
sync_env_only="$(decode_remote_arg "${15:-__EMPTY__}")"
app_env_file_name="$(decode_remote_arg "${16:-__EMPTY__}")"
env_file_uploaded="$(decode_remote_arg "${17:-__EMPTY__}")"
deploy_update_strategy="$(decode_remote_arg "${18:-__EMPTY__}")"
case "${deploy_update_strategy}" in
  stack|service) ;;
  *)
    echo "Invalid remote DEPLOY_UPDATE_STRATEGY: $deploy_update_strategy" >&2
    exit 1
    ;;
esac
validate_relative_path() {
  local value="$1"
  [ -n "$value" ] || return 1
  [[ "$value" != /* ]] || return 1
  [[ "$value" != *..* ]] || return 1
  [[ "$value" =~ ^[A-Za-z0-9_./-]+$ ]] || return 1
}
if ! validate_relative_path "$docker_build_context"; then
  echo "Invalid remote DOCKER_BUILD_CONTEXT: $docker_build_context" >&2
  exit 1
fi
if ! validate_relative_path "$dockerfile"; then
  echo "Invalid remote DOCKERFILE: $dockerfile" >&2
  exit 1
fi

service_names=()
compose_service_names=()
while IFS= read -r service; do
  [ -n "$service" ] || continue
  prefix="${stack}_"
  if [[ "$service" != "$prefix"* ]]; then
    echo "Docker service $service must belong to stack $stack and start with ${prefix}." >&2
    exit 1
  fi
  compose_service="${service#"$prefix"}"
  if [[ ! "$compose_service" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    echo "Invalid compose service name resolved from $service: $compose_service" >&2
    exit 1
  fi
  service_names+=("$service")
  compose_service_names+=("$compose_service")
done <<< "$service_names_raw"

current_link="${deploy_apps_root}/${stack}/current"

if [ "$sync_env_only" != "true" ]; then
  release_root="${deploy_apps_root}/${stack}/releases"
  release_dir="${release_root}/${sha}"

  sudo install -d -o "$deploy_user" -g "$deploy_user" -m 700 "${deploy_apps_root}/${stack}" "$release_root"
  rm -rf "$release_dir"
  install -d -m 700 "$release_dir"
  tar -xzf "$remote_archive" -C "$release_dir"
  rm -f "$remote_archive"
  ln -sfn "$release_dir" "$current_link"

  build_args=()
  if [ -n "$docker_build_args_raw" ]; then
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      if [[ ! "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
        echo "Invalid DOCKER_BUILD_ARGS line: $line" >&2
        exit 1
      fi
      build_args+=(--build-arg "$line")
    done <<< "$docker_build_args_raw"
  fi
  if [ -n "$app_env_file_name" ] && [ -f "${deploy_apps_root}/${stack}/${app_env_file_name}" ]; then
    while IFS='=' read -r key value; do
      [ -n "$key" ] || continue
      case "$key" in
        NEXT_PUBLIC_*|VITE_*|NUXT_PUBLIC_*|PUBLIC_*)
          clean_value="${value%\"}"
          clean_value="${clean_value#\"}"
          clean_value="${clean_value%\'}"
          clean_value="${clean_value#\'}"
          build_args+=(--build-arg "${key}=${clean_value}")
          ;;
      esac
    done < "${deploy_apps_root}/${stack}/${app_env_file_name}"
  fi

  build_context_path="$release_dir/$docker_build_context"
  dockerfile_path="$release_dir/$dockerfile"
  if [ ! -d "$build_context_path" ]; then
    echo "Docker build context does not exist: $build_context_path" >&2
    exit 1
  fi
  if [ ! -f "$dockerfile_path" ]; then
    echo "Dockerfile does not exist: $dockerfile_path" >&2
    exit 1
  fi

  docker build "${build_args[@]}" -f "$dockerfile_path" -t "$image_ref" "$build_context_path"
fi

missing_services=()
for service in "${service_names[@]}"; do
  if ! docker service inspect "$service" >/dev/null 2>&1; then
    missing_services+=("$service")
  fi
done
if [ "${#missing_services[@]}" -gt 0 ]; then
  if [ "$sync_env_only" = "true" ]; then
    printf 'Docker service %s does not exist; cannot apply env-only deploy before first infra-as-code stack deploy.\n' "${missing_services[0]}" >&2
    exit 1
  fi
  printf 'Docker service %s does not exist yet; built %s for the first infra-as-code stack deploy.\n' "${missing_services[0]}" "$image_ref"
  exit 0
fi

service_update_timeout="${SERVICE_UPDATE_TIMEOUT_SECONDS:-360}"
if [[ ! "$service_update_timeout" =~ ^[0-9]+$ ]] || [ "$service_update_timeout" -lt 30 ]; then
  echo "SERVICE_UPDATE_TIMEOUT_SECONDS must be an integer >= 30." >&2
  exit 1
fi

wait_for_service_update() {
  local service="$1"
  local deadline=$((SECONDS + service_update_timeout))
  local status=""
  local replicas=""

  while [ "$SECONDS" -lt "$deadline" ]; do
    status="$(docker service inspect "$service" --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{end}}' 2>/dev/null || true)"
    replicas="$(
      docker service ls --filter "name=$service" --format '{{.Name}} {{.Replicas}}' \
        | awk -v svc="$service" '$1 == svc {print $2; exit}'
    )"

    case "$status" in
      rollback_started|rollback_paused|rollback_completed|paused)
        echo "Swarm update entered bad state for $service: $status" >&2
        return 1
        ;;
    esac

    if [[ "$replicas" =~ ^([0-9]+)/\1$ ]] && [ "${BASH_REMATCH[1]}" -gt 0 ] && { [ -z "$status" ] || [ "$status" = "completed" ]; }; then
      return 0
    fi

    sleep 3
  done

  echo "Timed out waiting for $service update after ${service_update_timeout}s." >&2
  docker service inspect "$service" --format '{{json .UpdateStatus}}' || true
  docker service ps --no-trunc "$service" || true
  return 1
}

run_smoke_check() {
  if [ -z "$smoke_url" ]; then
    return 0
  fi

  smoke_cmd=(curl -fsS --retry 12 --retry-delay 5 --retry-connrefused)
  if [ "$smoke_insecure" = "true" ]; then
    smoke_cmd+=(-k)
  fi
  if [ -n "$smoke_resolve" ]; then
    smoke_cmd+=(--resolve "$smoke_resolve")
  fi
  if [ -n "$smoke_host_header" ]; then
    smoke_cmd+=(-H "Host: $smoke_host_header")
  fi
  smoke_cmd+=("$smoke_url")
  "${smoke_cmd[@]}" >/dev/null
}

if [ "$deploy_update_strategy" = "service" ]; then
  env_remove_args=()
  env_add_args=()
  env_file_path=""
  if [ -n "$app_env_file_name" ]; then
    env_file_path="${deploy_apps_root}/${stack}/${app_env_file_name}"
  fi
  if [ -n "$env_file_path" ] && [ -f "$env_file_path" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line%$'\r'}"
      case "$line" in
        ''|\#*) continue ;;
      esac
      if [[ ! "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
        echo "Invalid env file line in $env_file_path: ${line%%=*}" >&2
        exit 1
      fi
      key="${line%%=*}"
      value="${line#*=}"
      env_remove_args+=(--env-rm "$key")
      env_add_args+=(--env-add "${key}=${value}")
    done < "$env_file_path"
  fi

  for service in "${service_names[@]}"; do
    update_args=(
      --detach=false
      --update-order start-first
      --update-failure-action rollback
      --update-monitor 60s
      --rollback-monitor 60s
    )
    if [ "${#env_remove_args[@]}" -gt 0 ]; then
      update_args+=("${env_remove_args[@]}" "${env_add_args[@]}")
    fi
    if [ "$sync_env_only" != "true" ]; then
      previous_image="$(docker service inspect "$service" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null || true)"
      echo "Updating $service from ${previous_image:-<unknown>} to $image_ref"
      update_args+=(--image "$image_ref")
    else
      echo "Applying runtime env to $service without changing image."
    fi

    set +e
    docker service update "${update_args[@]}" "$service"
    update_rc=$?
    set -e
    if [ "$update_rc" -ne 0 ]; then
      echo "Service update failed for $service; Docker already attempted rollback because update-failure-action=rollback." >&2
      docker service ps --no-trunc "$service" || true
      restore_env_marker="${deploy_apps_root}/${stack}/.last-env-backup-${app_env_file_name#.}"
      if [ "$env_file_uploaded" = "true" ] && [ -f "$restore_env_marker" ]; then
        backup_env="$(cat "$restore_env_marker" || true)"
        if [ "$backup_env" = "__NONE__" ]; then
          rm -f "$env_file_path" || true
        elif [ -n "$backup_env" ] && [ -f "$backup_env" ]; then
          cp -p "$backup_env" "$env_file_path" || true
        fi
      fi
      exit "$update_rc"
    fi
    wait_for_service_update "$service"
  done

  if ! run_smoke_check; then
    echo "Smoke check failed; rolling back services and restoring previous env file." >&2
    for service in "${service_names[@]}"; do
      docker service update --rollback --detach=true "$service" || true
      wait_for_service_update "$service" || true
      docker service ps --no-trunc "$service" || true
    done
    restore_env_marker="${deploy_apps_root}/${stack}/.last-env-backup-${app_env_file_name#.}"
    if [ "$env_file_uploaded" = "true" ] && [ -f "$restore_env_marker" ]; then
      backup_env="$(cat "$restore_env_marker" || true)"
      if [ "$backup_env" = "__NONE__" ]; then
        rm -f "$env_file_path" || true
      elif [ -n "$backup_env" ] && [ -f "$backup_env" ]; then
        cp -p "$backup_env" "$env_file_path" || true
      fi
    fi
    exit 1
  fi

  for service in "${service_names[@]}"; do
    docker service ps --no-trunc "$service"
    docker service inspect "$service" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
  done
  exit 0
fi

stack_file="${deploy_apps_root}/${stack}/stack.yml"
if [ ! -f "$stack_file" ]; then
  echo "Server-side stack file is missing: $stack_file. Run infra-as-code first deploy before routine app deploy." >&2
  exit 1
fi

stack_backup_dir="${deploy_apps_root}/${stack}/backups/stack"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -o "$deploy_user" -g "$deploy_user" -m 700 "$stack_backup_dir"
stack_backup="${stack_backup_dir}/stack.yml.${timestamp}"
cp -p "$stack_file" "$stack_backup"

restore_stack_and_env() {
  if [ -f "${stack_backup:-}" ]; then
    cp -p "$stack_backup" "$stack_file" || true
  fi
  if [ "$env_file_uploaded" = "true" ] && [ -n "$app_env_file_name" ]; then
    marker="${deploy_apps_root}/${stack}/.last-env-backup-${app_env_file_name#.}"
    target_env="${deploy_apps_root}/${stack}/${app_env_file_name}"
    if [ -f "$marker" ]; then
      backup_env="$(cat "$marker" || true)"
      if [ "$backup_env" = "__NONE__" ]; then
        rm -f "$target_env" || true
      elif [ -n "$backup_env" ] && [ -f "$backup_env" ]; then
        cp -p "$backup_env" "$target_env" || true
      fi
    fi
  fi
}

image_map_file="$(mktemp)"
for index in "${!service_names[@]}"; do
  service="${service_names[$index]}"
  compose_service="${compose_service_names[$index]}"
  if [ "$sync_env_only" = "true" ]; then
    target_image="$(docker service inspect "$service" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}')"
  else
    target_image="$image_ref"
  fi
  previous_image="$(docker service inspect "$service" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null || true)"
  echo "Preparing $service from ${previous_image:-<unknown>} to $target_image"
  printf '%s\t%s\n' "$compose_service" "$target_image" >> "$image_map_file"
done

tmp_stack="$(mktemp)"
awk -v map_file="$image_map_file" '
  BEGIN {
    while ((getline line < map_file) > 0) {
      tab = index(line, "\t")
      if (tab <= 1) {
        continue
      }
      service = substr(line, 1, tab - 1)
      image = substr(line, tab + 1)
      target[service] = image
    }
    close(map_file)
  }
  /^services:[[:space:]]*$/ {
    in_services = 1
    current = ""
    print
    next
  }
  in_services && /^[A-Za-z0-9_.-]+:/ && $0 !~ /^services:/ {
    in_services = 0
    current = ""
  }
  in_services && $0 ~ /^  [A-Za-z0-9_.-]+:[[:space:]]*$/ {
    current = $0
    sub(/^  /, "", current)
    sub(/:.*/, "", current)
    print
    next
  }
  in_services && (current in target) && $0 ~ /^[[:space:]]+image:[[:space:]]*/ {
    indent = $0
    sub(/image:.*/, "", indent)
    print indent "image: \"" target[current] "\""
    updated[current] = 1
    next
  }
  {
    print
  }
  END {
    missing = 0
    for (service in target) {
      if (!(service in updated)) {
        print "Missing image field for compose service " service " in stack file." > "/dev/stderr"
        missing = 1
      }
    }
    if (missing) {
      exit 42
    }
  }
' "$stack_file" > "$tmp_stack" || {
  rc=$?
  rm -f "$tmp_stack" "$image_map_file"
  restore_stack_and_env
  exit "$rc"
}
cat "$tmp_stack" > "$stack_file"
rm -f "$tmp_stack" "$image_map_file"

set +e
docker stack deploy --resolve-image never -c "$stack_file" "$stack"
deploy_rc=$?
set -e
if [ "$deploy_rc" -ne 0 ]; then
  echo "docker stack deploy failed for $stack; restoring previous stack/env files." >&2
  restore_stack_and_env
  exit "$deploy_rc"
fi

services_to_wait=()
while IFS= read -r service; do
  [ -n "$service" ] || continue
  services_to_wait+=("$service")
done < <(docker stack services "$stack" --format '{{.Name}}' 2>/dev/null || true)
if [ "${#services_to_wait[@]}" -eq 0 ]; then
  services_to_wait=("${service_names[@]}")
fi

for service in "${services_to_wait[@]}"; do
  if ! wait_for_service_update "$service"; then
    echo "Stack deploy did not converge for $service; attempting rollback and restoring previous stack/env files." >&2
    docker service update --rollback --detach=true "$service" || true
    wait_for_service_update "$service" || true
    restore_stack_and_env
    exit 1
  fi
done

if [ -n "$smoke_url" ]; then
  smoke_cmd=(curl -fsS --retry 12 --retry-delay 5 --retry-connrefused)
  if [ "$smoke_insecure" = "true" ]; then
    smoke_cmd+=(-k)
  fi
  if [ -n "$smoke_resolve" ]; then
    smoke_cmd+=(--resolve "$smoke_resolve")
  fi
  if [ -n "$smoke_host_header" ]; then
    smoke_cmd+=(-H "Host: $smoke_host_header")
  fi
  smoke_cmd+=("$smoke_url")
  set +e
  "${smoke_cmd[@]}" >/dev/null
  smoke_rc=$?
  set -e
  if [ "$smoke_rc" -ne 0 ]; then
    echo "Smoke check failed; rolling back services and restoring previous stack/env files." >&2
    for service in "${services_to_wait[@]}"; do
      docker service update --rollback --detach=true "$service" || true
      wait_for_service_update "$service" || true
      docker service ps --no-trunc "$service" || true
    done
    restore_stack_and_env
    exit "$smoke_rc"
  fi
fi

for service in "${services_to_wait[@]}"; do
  docker service ps --no-trunc "$service"
  docker service inspect "$service" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
done
REMOTE_DEPLOY
