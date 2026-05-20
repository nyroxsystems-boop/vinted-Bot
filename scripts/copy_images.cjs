const fs = require('fs');
const path = require('path');

const srcDir = '/Users/home/.gemini/antigravity/brain/7f9d27bf-42d3-43dc-a546-50eb0a19e211';
const destDir = '/Users/home/Vinted/Vinted/Kleider/3/CJLY2226692_1778078405588/generated';

fs.mkdirSync(destDir, { recursive: true });

const files = {
  'kleid3_1_front_1778349128772.png': '1_front.jpg',
  'kleid3_2_side_1778349144575.png': '2_side.jpg',
  'kleid3_3_back_1778349159781.png': '3_back.jpg',
  'kleid3_4_selfie_1778349175668.png': '4_selfie_detail.jpg',
  'kleid3_5_flatlay_1778349190068.png': '5_flatlay.jpg'
};

for (const [src, dest] of Object.entries(files)) {
  fs.copyFileSync(path.join(srcDir, src), path.join(destDir, dest));
  console.log(`Copied ${src} to ${dest}`);
}
