#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

version=9.1
source_sha256=1a4d394ae63d190a526cd052eb4415c156b5c5e2df37efab41a7de0b8fde2433
release_signer=FCF986EA15E6E293A5644F10B4322F04D67658D8
source_name="ffmpeg-$version.tar.xz"
source_url="https://ffmpeg.org/releases/$source_name"
asset_name="veloxa-ffprobe-$version-linux-x64"
recipe_path=$(realpath "${BASH_SOURCE[0]}")
output_path=${1:?Specify an output directory}
source_bundle=${2:-}

if [[ $(uname -s) != Linux || $(uname -m) != x86_64 || $(getconf GNU_LIBC_VERSION) != 'glibc 2.35' ]]; then
  printf '%s\n' 'Build this binary on Ubuntu 22.04 x86-64 with glibc 2.35.' >&2
  exit 1
fi

mkdir -p "$output_path"
output_path=$(cd "$output_path" && pwd)
if [[ -n "$source_bundle" ]]; then source_bundle=$(cd "$source_bundle" && pwd); fi
workspace=$(mktemp -d)
trap 'rm -rf "$workspace"' EXIT
cd "$workspace"

if [[ -n "$source_bundle" ]]; then
  cp "$source_bundle/"{"$source_name","$source_name.asc",ffmpeg-devel.asc} .
else
  download=(curl --fail --silent --show-error --location --proto '=https' --retry 2 --max-time 120)
  "${download[@]}" "$source_url" -o "$source_name"
  "${download[@]}" "$source_url.asc" -o "$source_name.asc"
  "${download[@]}" https://ffmpeg.org/ffmpeg-devel.asc -o ffmpeg-devel.asc
fi

printf '%s  %s\n' "$source_sha256" "$source_name" | sha256sum --check
mkdir -m 700 gnupg
gpg --batch --homedir "$workspace/gnupg" --import ffmpeg-devel.asc
gpg --batch --no-auto-key-retrieve --homedir "$workspace/gnupg" --status-fd 1 \
  --verify "$source_name.asc" "$source_name" > signing-status.txt
awk -v signer="$release_signer" '
  $1 == "[GNUPG:]" && $2 == "VALIDSIG" && ($3 == signer || $NF == signer) { valid = 1 }
  END { exit !valid }
' signing-status.txt
tar -xJf "$source_name"

cd "ffmpeg-$version"
./configure --disable-autodetect --disable-gpl --disable-nonfree --disable-version3 \
  --disable-network --disable-ffmpeg --disable-ffplay --enable-ffprobe \
  --disable-avdevice --disable-avfilter --disable-swscale --enable-swresample \
  --disable-doc --disable-debug --disable-x86asm --disable-iconv \
  --disable-everything --enable-demuxer=mov,matroska --enable-protocol=file \
  --enable-parsers \
  --enable-decoder=aac,aac_latm,ac3,alac,av1,flac,h264,hevc,mjpeg,mpeg4,mp3,opus,png,prores,vorbis,vp8,vp9,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be
make -j"$(nproc)" ffprobe

./ffprobe -version | tee "$workspace/ffprobe-version.txt"
grep -Eq "^ffprobe version (n)?$version([[:space:]]|$)" "$workspace/ffprobe-version.txt"
grep -qx 'CONFIG_FFPROBE=yes' ffbuild/config.mak
grep -qx 'CONFIG_OPUS_DECODER=yes' ffbuild/config.mak
test "$(./ffprobe -protocols | awk '/^  [[:alnum:]]/ { print $1 }' | sort -u)" = file
readelf --dynamic ffprobe | tee "$workspace/elf-dependencies.txt"
readelf --version-info ffprobe > "$workspace/elf-versions.txt"
while IFS= read -r dependency; do
  case "$dependency" in
    libc.so.6|libm.so.6|libpthread.so.0|libdl.so.2|librt.so.1|libgcc_s.so.1) ;;
    *) printf 'Unexpected shared dependency %s\n' "$dependency" >&2; exit 1 ;;
  esac
done < <(sed -n 's/.*Shared library: \[\([^]]*\)\].*/\1/p' "$workspace/elf-dependencies.txt")
glibc_limit=$(grep -Eo 'GLIBC_[0-9.]*' "$workspace/elf-versions.txt" | sort -V | tail -n 1)
if [[ "$(printf '%s\n' "$glibc_limit" GLIBC_2.35 | sort -V | tail -n 1)" != GLIBC_2.35 ]]; then
  printf 'The binary requires %s.\n' "$glibc_limit" >&2
  exit 1
fi

package="$workspace/$asset_name"
mkdir -p "$package"
cp ffprobe "$package/"
cp COPYING.LGPLv2.1 "$package/LICENSE.txt"
cp LICENSE.md "$package/UPSTREAM-LICENSE.md"
cp "$workspace/$source_name" "$workspace/$source_name.asc" "$workspace/ffmpeg-devel.asc" "$package/"
cp "$recipe_path" "$package/BUILD-RECIPE.sh"
cp "$workspace/"{signing-status,ffprobe-version,elf-dependencies,elf-versions}.txt "$package/"
cd "$workspace"
archive="$output_path/$asset_name.tar.xz"
tar --sort=name --mtime='2026-11-20 00:00:00 UTC' --owner=0 --group=0 --numeric-owner \
  -cJf "$archive" "$asset_name"
python3 - "$archive" "$package" "$source_name" "$source_url" <<'PY'
import hashlib
import json
from pathlib import Path
import sys

archive, package = map(Path, sys.argv[1:3])
source_name, source_url = sys.argv[3:5]

def metadata(path):
    return {"bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}

result = {
    "archive": {"name": archive.name, **metadata(archive)},
    "binary": {"member": f"{package.name}/ffprobe", **metadata(package / "ffprobe")},
    "license": {"member": f"{package.name}/LICENSE.txt", **metadata(package / "LICENSE.txt")},
    "source": {"url": source_url, "member": f"{package.name}/{source_name}", **metadata(package / source_name)},
}
encoded = json.dumps(result, indent=2) + "\n"
archive.with_suffix(".json").write_text(encoded, encoding="utf-8")
print(encoded, end="")
PY
