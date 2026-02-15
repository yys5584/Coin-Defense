import fs from 'fs';
import { createCanvas, loadImage } from 'canvas';

async function main() {
    const img = await loadImage('public/images/ui/rpg-spritesheet.png');
    const w = img.width;
    const h = img.height;
    console.log(`Spritesheet: ${w}x${h}`);

    // Define sprite regions (x, y, width, height, name)
    const sprites = [
        // Top banner/ribbon
        { x: 0, y: 0, w: 64, h: 16, name: 'banner-ribbon' },
        // Small wooden sign
        { x: 96, y: 0, w: 64, h: 48, name: 'sign-small' },
        // Emblem shields
        { x: 192, y: 0, w: 32, h: 32, name: 'emblem-star' },
        { x: 224, y: 0, w: 32, h: 32, name: 'emblem-gem' },
        // Large wooden panel (left)
        { x: 0, y: 48, w: 80, h: 112, name: 'wood-panel-large' },
        // Medium wooden panel (middle)
        { x: 80, y: 32, w: 80, h: 96, name: 'wood-panel-medium' },
        // Hanging wooden board
        { x: 160, y: 32, w: 96, h: 96, name: 'wood-panel-hanging' },
        // Round buttons row 1
        { x: 0, y: 176, w: 20, h: 20, name: 'rbtn-1' },
        { x: 20, y: 176, w: 20, h: 20, name: 'rbtn-2' },
        { x: 40, y: 176, w: 20, h: 20, name: 'rbtn-3' },
        { x: 60, y: 176, w: 20, h: 20, name: 'rbtn-4' },
        { x: 80, y: 176, w: 20, h: 20, name: 'rbtn-5' },
        { x: 100, y: 176, w: 20, h: 20, name: 'rbtn-6' },
        { x: 120, y: 176, w: 20, h: 20, name: 'rbtn-7' },
        { x: 140, y: 176, w: 20, h: 20, name: 'rbtn-8' },
        // Round buttons row 2
        { x: 0, y: 198, w: 20, h: 20, name: 'rbtn-9' },
        { x: 20, y: 198, w: 20, h: 20, name: 'rbtn-10' },
        { x: 40, y: 198, w: 20, h: 20, name: 'rbtn-11' },
        { x: 60, y: 198, w: 20, h: 20, name: 'rbtn-12' },
        { x: 80, y: 198, w: 20, h: 20, name: 'rbtn-13' },
        { x: 100, y: 198, w: 20, h: 20, name: 'rbtn-14' },
        { x: 120, y: 198, w: 20, h: 20, name: 'rbtn-15' },
        // Arrows and items at bottom
        { x: 160, y: 176, w: 16, h: 48, name: 'arrow-1' },
        { x: 176, y: 176, w: 16, h: 48, name: 'arrow-2' },
        { x: 192, y: 176, w: 16, h: 48, name: 'arrow-3' },
    ];

    for (const s of sprites) {
        const canvas = createCanvas(s.w, s.h);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
        const buf = canvas.toBuffer('image/png');
        fs.writeFileSync(`public/images/ui/${s.name}.png`, buf);
        console.log(`Saved ${s.name}.png (${s.w}x${s.h})`);
    }
}

main().catch(e => console.error(e));
