// Re-slice RPG spritesheet on strict 32px grid
// Spritesheet is 256x256 = 8x8 grid of 32x32 tiles

import fs from 'fs';
import { createCanvas, loadImage } from 'canvas';

async function main() {
    const img = await loadImage('public/images/ui/rpg-spritesheet.png');
    console.log(`Spritesheet: ${img.width}x${img.height}`);
    console.log(`Grid: ${img.width / 32}x${img.height / 32} tiles (32px each)`);

    // Clean up old sliced files
    const oldFiles = fs.readdirSync('public/images/ui').filter(f =>
        f !== 'rpg-spritesheet.png' && f.endsWith('.png')
    );
    for (const f of oldFiles) {
        fs.unlinkSync(`public/images/ui/${f}`);
        console.log(`Deleted old: ${f}`);
    }

    // Extract every non-empty 32x32 tile from the spritesheet
    const tileSize = 32;
    const cols = img.width / tileSize;
    const rows = img.height / tileSize;

    // First pass: extract all tiles and see which are non-empty
    const tiles = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const canvas = createCanvas(tileSize, tileSize);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, col * tileSize, row * tileSize, tileSize, tileSize, 0, 0, tileSize, tileSize);

            // Check if tile is non-empty (has any non-transparent pixels)
            const data = ctx.getImageData(0, 0, tileSize, tileSize).data;
            let hasContent = false;
            for (let i = 3; i < data.length; i += 4) {
                if (data[i] > 10) { hasContent = true; break; }
            }

            if (hasContent) {
                const name = `tile_r${row}_c${col}`;
                const buf = canvas.toBuffer('image/png');
                fs.writeFileSync(`public/images/ui/${name}.png`, buf);
                tiles.push({ row, col, name });
                console.log(`Saved ${name}.png (row=${row}, col=${col})`);
            }
        }
    }

    console.log(`\nTotal non-empty tiles: ${tiles.length}`);

    // Also extract multi-tile sprites (exactly on grid boundaries)
    // Large panel: 3x3 tiles starting at (0,1) = 96x96
    extractMultiTile(img, 0, 1, 3, 3, 'panel_3x3_a');
    // Another panel: 3x3 tiles starting at (3,1) = 96x96  
    extractMultiTile(img, 3, 1, 3, 3, 'panel_3x3_b');
    // Hanging board: 3x3 tiles starting at (5,1) = 96x96
    extractMultiTile(img, 5, 1, 3, 3, 'panel_3x3_c');
    // Banner: 2x1 tiles at (0,0) = 64x32
    extractMultiTile(img, 0, 0, 2, 1, 'banner_2x1');
    // Sign: 2x2 tiles at (3,0) = 64x64
    extractMultiTile(img, 3, 0, 2, 2, 'sign_2x2');
}

function extractMultiTile(img, startCol, startRow, tileCols, tileRows, name) {
    const ts = 32;
    const w = tileCols * ts;
    const h = tileRows * ts;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, startCol * ts, startRow * ts, w, h, 0, 0, w, h);
    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(`public/images/ui/${name}.png`, buf);
    console.log(`Saved multi-tile: ${name}.png (${w}x${h}, from col=${startCol},row=${startRow})`);
}

main().catch(e => console.error(e));
