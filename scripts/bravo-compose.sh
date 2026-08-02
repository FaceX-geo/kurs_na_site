#!/usr/bin/env bash

set -euo pipefail

readonly BRAVO_CONTEXT="remote-build"
readonly BRAVO_EXPECTED_ENDPOINT="ssh://bravo-108"
readonly SCRIPT_DIRECTORY="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
readonly PROJECT_ROOT="$(CDPATH= cd -- "${SCRIPT_DIRECTORY}/.." && pwd -P)"
readonly DOCKER_USER_CONFIG="${DOCKER_CONFIG:-${HOME}/.docker}"
readonly BRAVO_CLIENT_CONFIG="$(
  mktemp -d "${TMPDIR:-/tmp}/kurs-na-sever-docker.XXXXXX"
)"

cleanup_client_config() {
  case "${BRAVO_CLIENT_CONFIG}" in
    */kurs-na-sever-docker.*)
      rm -rf -- "${BRAVO_CLIENT_CONFIG}"
      ;;
    *)
      printf 'Refusing to clean unexpected temporary path: %s\n' "${BRAVO_CLIENT_CONFIG}" >&2
      ;;
  esac
}

trap cleanup_client_config EXIT

if [[ ! -d "${DOCKER_USER_CONFIG}/contexts" ]]; then
  printf 'Docker context store is unavailable: %s\n' "${DOCKER_USER_CONFIG}/contexts" >&2
  exit 69
fi

ln -s "${PROJECT_ROOT}/docker/bravo-client-config.json" "${BRAVO_CLIENT_CONFIG}/config.json"
ln -s "${DOCKER_USER_CONFIG}/contexts" "${BRAVO_CLIENT_CONFIG}/contexts"

if [[ "${BRAVO_CONTEXT}" == "default" || "${BRAVO_CONTEXT}" == "desktop-linux" ]]; then
  printf 'Refusing local Docker context: %s\n' "${BRAVO_CONTEXT}" >&2
  exit 64
fi

actual_endpoint="$(
  DOCKER_CONFIG="${BRAVO_CLIENT_CONFIG}" docker context inspect "${BRAVO_CONTEXT}" \
    --format '{{ .Endpoints.docker.Host }}' 2>/dev/null
)" || {
  printf 'Docker context "%s" is unavailable.\n' "${BRAVO_CONTEXT}" >&2
  exit 69
}

if [[ "${actual_endpoint}" != "${BRAVO_EXPECTED_ENDPOINT}" ]]; then
  printf 'Refusing unexpected Docker endpoint: %s\n' "${actual_endpoint}" >&2
  printf 'Expected Bravo endpoint: %s\n' "${BRAVO_EXPECTED_ENDPOINT}" >&2
  exit 65
fi

destructive_command=false
volume_deletion=false

for argument in "$@"; do
  case "${argument}" in
    down|rm)
      destructive_command=true
      ;;
    -v|--volumes)
      volume_deletion=true
      ;;
  esac
done

if [[ "${destructive_command}" == true && "${volume_deletion}" == true ]]; then
  printf 'Refusing to delete Docker volumes without an explicit infrastructure workflow.\n' >&2
  exit 77
fi

printf 'Bravo Compose: context=%s endpoint=%s project=%s\n' \
  "${BRAVO_CONTEXT}" "${actual_endpoint}" "${PROJECT_ROOT}" >&2

if DOCKER_CONFIG="${BRAVO_CLIENT_CONFIG}" docker compose version >/dev/null 2>&1; then
  DOCKER_CONFIG="${BRAVO_CLIENT_CONFIG}" docker \
    --context "${BRAVO_CONTEXT}" \
    compose \
    --project-directory "${PROJECT_ROOT}" \
    "$@"
  exit $?
fi

if command -v docker-compose >/dev/null 2>&1; then
  DOCKER_CONFIG="${BRAVO_CLIENT_CONFIG}" docker-compose \
    --context "${BRAVO_CONTEXT}" \
    --project-directory "${PROJECT_ROOT}" \
    "$@"
  exit $?
fi

printf 'Docker Compose CLI is unavailable. Install the client before using Bravo.\n' >&2
exit 69
