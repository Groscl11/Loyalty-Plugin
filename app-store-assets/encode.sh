#!/bin/zsh
set -e
cd ~/Documents/Projects/Loyalty-Plugin/app-store-assets
FF=$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
rm -rf clips && mkdir -p clips
scenes=("01-title:4" "02-step1:3" "03-dashboard:6" "04-step2:3" "05-widget:6" "06-step3:3" "07-redeem:6" "08-closing:4")
i=0
for entry in "${scenes[@]}"; do
  name="${entry%%:*}"; dur="${entry##*:}"
  fout=$(python3 -c "print(f'{$dur-0.5:.2f}')")
  "$FF" -y -loglevel error -framerate 30 -loop 1 -t "$dur" -i "sd/$name.png" \
    -vf "fade=t=in:st=0:d=0.4,fade=t=out:st=${fout}:d=0.4,format=yuv420p" \
    -c:v libx264 -preset veryfast -crf 21 -r 30 "clips/$(printf '%d' $i)_${name}.mp4"
  i=$((i+1))
done
: > concat.txt
for f in clips/*.mp4; do echo "file '$PWD/$f'" >> concat.txt; done
sort -o concat.txt concat.txt
"$FF" -y -loglevel error -f concat -safe 0 -i concat.txt -c copy -movflags +faststart demo.mp4
echo "DONE"
"$FF" -i demo.mp4 2>&1 | grep -E "Duration|Stream" || true
