// ============================================================
// Sprite System — Origin-based sprite mapping with cost-tier effects
// 이미지가 없으면 이모지로 폴백
// ============================================================

import { Origin } from '../core/types';

// ─── Origin별 스프라이트 경로 ─────────────────────────────────
// public/sprites/ 폴더에 이미지를 넣으면 자동 적용됩니다
// 파일 형식: PNG (투명 배경 권장), 64×64 이상

const ORIGIN_SPRITES: Record<string, string> = {
    [Origin.Bitcoin]: '/sprites/bitcoin.png',
    [Origin.DeFi]: '/sprites/defi.png',
    [Origin.Social]: '/sprites/social.png',
    [Origin.Exchange]: '/sprites/exchange.png',
    [Origin.VC]: '/sprites/vc.png',
    [Origin.FUD]: '/sprites/fud.png',
    [Origin.Rugpull]: '/sprites/rugpull.png',
    [Origin.Bear]: '/sprites/bear.png',
};

// ─── 몬스터 스프라이트 ───────────────────────────────────────
export const MONSTER_SPRITE = '/sprites/monster.png';
export const BOSS_SPRITE = '/sprites/boss.png';

// ─── 코스트별 테두리 글로우 색상 ─────────────────────────────
export const COST_GLOW: Record<number, string> = {
    1: '#94a3b8',  // 회색
    2: '#22c55e',  // 초록
    3: '#3b82f6',  // 파랑
    4: '#a855f7',  // 보라
    5: '#f97316',  // 주황
    7: '#eab308',  // 금색
    10: '#ef4444',  // 빨강 (전설)
};

export const COST_GLOW_SHADOW: Record<number, string> = {
    1: '0 0 4px rgba(148,163,184,.3)',
    2: '0 0 6px rgba(34,197,94,.4)',
    3: '0 0 8px rgba(59,130,246,.4)',
    4: '0 0 10px rgba(168,85,247,.5)',
    5: '0 0 12px rgba(249,115,22,.5)',
    7: '0 0 16px rgba(234,179,8,.6)',
    10: '0 0 20px rgba(239,68,68,.7)',
};

// ─── 스프라이트 로드 캐시 ────────────────────────────────────
const spriteCache = new Map<string, HTMLImageElement | null>();
const loadingSet = new Set<string>();

/**
 * 이미지를 미리 로드하고 캐시합니다.
 * 존재하지 않는 이미지는 null로 캐시됩니다.
 */
function preloadSprite(src: string): Promise<HTMLImageElement | null> {
    if (spriteCache.has(src)) return Promise.resolve(spriteCache.get(src)!);
    if (loadingSet.has(src)) return Promise.resolve(null);

    loadingSet.add(src);
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            spriteCache.set(src, img);
            loadingSet.delete(src);
            resolve(img);
        };
        img.onerror = () => {
            spriteCache.set(src, null); // 이미지 없음 → 이모지 폴백
            loadingSet.delete(src);
            resolve(null);
        };
        img.src = src;
    });
}

/**
 * Origin에 해당하는 스프라이트를 반환합니다.
 * 아직 로드 중이거나 없으면 null을 반환합니다.
 */
export function getOriginSprite(origin: string): HTMLImageElement | null {
    const src = ORIGIN_SPRITES[origin];
    if (!src) return null;

    if (spriteCache.has(src)) return spriteCache.get(src) ?? null;

    // 비동기 프리로드 시작 (다음 렌더에 사용 가능)
    preloadSprite(src);
    return null;
}

/**
 * 캐시된 스프라이트가 있는지 확인합니다.
 */
export function hasSpriteFor(origin: string): boolean {
    const src = ORIGIN_SPRITES[origin];
    if (!src) return false;
    const cached = spriteCache.get(src);
    return cached !== undefined && cached !== null;
}

/**
 * 모든 Origin 스프라이트를 미리 로드합니다.
 */
export async function preloadAllSprites(): Promise<void> {
    const promises = Object.values(ORIGIN_SPRITES).map(src => preloadSprite(src));
    promises.push(preloadSprite(MONSTER_SPRITE));
    promises.push(preloadSprite(BOSS_SPRITE));
    await Promise.all(promises);
}

/**
 * 몬스터 스프라이트를 반환합니다.
 */
export function getMonsterSprite(isBoss: boolean): HTMLImageElement | null {
    const src = isBoss ? BOSS_SPRITE : MONSTER_SPRITE;
    if (spriteCache.has(src)) return spriteCache.get(src) ?? null;
    preloadSprite(src);
    return null;
}

/**
 * 유닛 카드용 HTML 요소를 생성합니다 (이미지 또는 이모지).
 */
export function createUnitVisual(origin: string, emoji: string, size: number = 32): HTMLElement {
    const sprite = getOriginSprite(origin);

    if (sprite) {
        const img = document.createElement('img');
        img.src = sprite.src;
        img.alt = origin;
        img.width = size;
        img.height = size;
        img.style.cssText = 'image-rendering: pixelated; object-fit: contain; pointer-events: none;';
        img.draggable = false;
        return img;
    }

    // 폴백: 이모지
    const span = document.createElement('span');
    span.className = 'emoji';
    span.textContent = emoji;
    span.style.fontSize = `${size * 0.7}px`;
    return span;
}

/**
 * Canvas 위에 유닛 스프라이트를 그립니다 (전투 렌더링용).
 */
export function drawUnitSprite(
    ctx: CanvasRenderingContext2D,
    origin: string,
    emoji: string,
    x: number, y: number,
    size: number,
    cost: number = 1,
): void {
    const sprite = getOriginSprite(origin);

    // 코스트별 글로우 효과
    const glowColor = COST_GLOW[cost] || COST_GLOW[1];
    ctx.save();

    if (sprite) {
        // 글로우 아래 그리기
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = cost >= 5 ? 8 : cost >= 3 ? 5 : 3;
        ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
        ctx.shadowBlur = 0;
    } else {
        // 이모지 폴백
        ctx.font = `${size * 0.7}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, x, y);
    }

    ctx.restore();
}

/**
 * Canvas 위에 몬스터 스프라이트를 그립니다.
 */
export function drawMonsterSprite(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    size: number,
    isBoss: boolean,
    emoji: string = '👾',
): void {
    const sprite = getMonsterSprite(isBoss);

    ctx.save();
    if (sprite) {
        ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
    } else {
        ctx.font = `${size * 0.7}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(isBoss ? '🐉' : emoji, x, y);
    }
    ctx.restore();
}
