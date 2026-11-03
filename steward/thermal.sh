#!/usr/bin/env bash
# The steward's thermal governor — keeps the home box SILENT (the owner's one
# hard requirement: "the fans CANNOT come on and be loud").
#
#   steward/thermal.sh check     exit 0 iff the cap files are writable (the root unit is installed)
#   steward/thermal.sh run       govern until killed (run-once.sh runs it beside all heavy work)
#   steward/thermal.sh floor     drop the cap to the floor and exit (the runner's exit trap)
#
# Why a governor and not just pinning: the box is an i7-10750H laptop with turbo
# to 5 GHz. On 2026-11-03 ONE pinned physical core running the gate took the
# package from 46 °C to 89 °C in 15 s. Pinning limits how much runs; only the
# frequency limits how hot one core gets. So: read the package temperature every
# few seconds and move the steward's own two CPUs' scaling_max_freq to hold it
# under STEWARD_TEMP_MAX. No other CPU is touched.
#
# The cap files are root's; steward/systemd/algomancy-steward-cpucap.service (a
# ROOT unit, installed once) chowns exactly those two to bena at boot.
set -uo pipefail
CPUS="${STEWARD_CPUS:-5 11}"
MAX_C="${STEWARD_TEMP_MAX:-55}"     # hold the package under this (°C)
FLOOR=800000; CEIL="${STEWARD_MAX_KHZ:-3000000}"; STEP_DN=300000; STEP_UP=100000
LOG="${STEWARD_ROOT:-$HOME/algomancy-steward}/logs/thermal.log"

zone() { for z in /sys/class/thermal/thermal_zone*; do [ "$(cat "$z/type")" = x86_pkg_temp ] && { echo "$z/temp"; return; }; done; }
files() { for c in $CPUS; do echo "/sys/devices/system/cpu/cpu$c/cpufreq/scaling_max_freq"; done; }
setf() { for f in $(files); do echo "$1" > "$f" 2>/dev/null || return 1; done; }

case "${1:-run}" in
check) for f in $(files); do [ -w "$f" ] || { echo "thermal: $f is not writable — install steward/systemd/algomancy-steward-cpucap.service" >&2; exit 1; }; done; [ -n "$(zone)" ] ;;
floor) setf $FLOOR ;;
run)
  Z=$(zone); f=1200000; setf $f || exit 1; n=0
  while true; do
    t=$(( $(cat "$Z") / 1000 ))
    if   [ "$t" -ge "$MAX_C" ];          then f=$(( f - STEP_DN )); [ $f -lt $FLOOR ] && f=$FLOOR
    elif [ "$t" -le $(( MAX_C - 5 )) ]; then f=$(( f + STEP_UP )); [ $f -gt "$CEIL" ] && f=$CEIL; fi
    setf $f
    n=$((n + 1)); [ $((n % 20)) -eq 0 ] && echo "$(date -u +%FT%TZ) pkg=${t}C cap=$((f / 1000))MHz load=$(cut -d' ' -f1 /proc/loadavg)" >> "$LOG"
    sleep 3
  done ;;
esac
