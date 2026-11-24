#!/bin/bash
# 用 macOS 自带语音把 test-fixtures/visit-dialogue.txt 合成一段双人对话录音（模拟录音豆录音）
# 用法：[DIALOGUE=对话文件] scripts/make-test-audio.sh [输出文件，默认 test-fixtures/模拟客户拜访.m4a]
# 注意：客户声音必须用中文语音（如 "Eddy (中文（中国大陆）)"）；英文语音读中文会输出空白音频。
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-test-fixtures/模拟客户拜访.m4a}"
TMP="$(mktemp -d)"
SALES_VOICE="${SALES_VOICE:-Tingting}"
CUSTOMER_VOICE="${CUSTOMER_VOICE:-Eddy (中文（中国大陆）)}"
i=0
while IFS='|' read -r who line; do
  [ -z "$line" ] && continue
  i=$((i+1)); n=$(printf %02d $i)
  if [ "$who" = "C" ]; then v="$CUSTOMER_VOICE"; else v="$SALES_VOICE"; fi
  say -v "$v" -r 185 -o "$TMP/$n.aiff" "$line"
  afconvert -f WAVE -d LEI16@22050 -c 1 "$TMP/$n.aiff" "$TMP/$n.wav"
done < "${DIALOGUE:-test-fixtures/visit-dialogue.txt}"
python3 - "$TMP" <<'PY'
import wave, glob, sys
d = sys.argv[1]
files = sorted(glob.glob(f"{d}/[0-9]*.wav"))
out = wave.open(f"{d}/all.wav", "wb")
for i, f in enumerate(files):
    w = wave.open(f, "rb")
    if i == 0: out.setparams(w.getparams())
    out.writeframes(w.readframes(w.getnframes()))
    out.writeframes(b"\x00\x00" * int(22050 * 0.7))
    w.close()
out.close()
PY
afconvert -f m4af -d aac "$TMP/all.wav" "$OUT"
rm -rf "$TMP"
echo "已生成：$OUT"
echo "上传生成妙记：lark-cli drive +upload --as user --file \"$OUT\"  →  lark-cli minutes +upload --as user --file-token <file_token>"
