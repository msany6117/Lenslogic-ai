import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function compressImage(base64Str: string, maxWidth = 256, maxHeight = 256, quality = 0.55): Promise<string> {
  return new Promise((resolve) => {
    if (!base64Str || base64Str.startsWith('blob:')) {
      resolve('');
      return;
    }
    const match = base64Str.match(/^data:(image\/[a-z0-9-+.]+);base64,/i);
    const mimeType = match ? match[1].toLowerCase() : 'image/jpeg';

    let settled = false;
    const done = (val: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };
    const timer = setTimeout(() => done(mimeType === 'image/svg+xml' ? '' : base64Str), 4000);

    const img = new Image();
    img.onload = () => {
      let width = img.naturalWidth || img.width || maxWidth;
      let height = img.naturalHeight || img.height || maxHeight;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.max(1, Math.round((height * maxWidth) / width));
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.max(1, Math.round((width * maxHeight) / height));
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        try {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (mimeType === 'image/jpeg' || mimeType === 'image/svg+xml') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          if (mimeType === 'image/png' || mimeType === 'image/webp') {
            const webpData = canvas.toDataURL('image/webp', quality);
            if (webpData.startsWith('data:image/webp')) {
              done(webpData);
            } else {
              done(canvas.toDataURL('image/jpeg', quality));
            }
          } else {
            done(canvas.toDataURL('image/jpeg', quality));
          }
          return;
        } catch {
          // fall through to safe fallback
        }
      }
      done(mimeType === 'image/svg+xml' ? '' : base64Str);
    };
    img.onerror = () => {
      done(mimeType === 'image/svg+xml' ? '' : base64Str);
    };
    img.src = base64Str;
  });
}

/**
 * Superfast client-side image compression that decodes natively in the browser.
 * Accepts File, Blob, blob: URL, or existing base64 string and returns a compressed JPEG data URL.
 * Never returns a blob: URL or data:image/svg+xml string.
 */
export function compressToDataUrl(
  input: File | Blob | string,
  maxWidth = 512,
  maxHeight = 512,
  quality = 0.75
): Promise<string> {
  return new Promise((resolve) => {
    if (!input) {
      resolve('');
      return;
    }

    let url = '';
    let shouldRevoke = false;

    if (typeof input === 'string') {
      url = input;
    } else {
      url = URL.createObjectURL(input);
      shouldRevoke = true;
    }

    let settled = false;
    const done = (val: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (shouldRevoke) {
        try { URL.revokeObjectURL(url); } catch {}
      }
      resolve(val);
    };

    const timer = setTimeout(() => {
      if (typeof input === 'string' && /^data:image\/(jpeg|png|webp);/i.test(input)) {
        done(input);
      } else {
        done('');
      }
    }, 4000);

    const img = new Image();
    if (typeof input === 'string' && /^https?:\/\//i.test(input)) {
      img.crossOrigin = "anonymous";
    }

    img.onload = () => {
      let width = img.naturalWidth || img.width || maxWidth;
      let height = img.naturalHeight || img.height || maxHeight;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.max(1, Math.round((height * maxWidth) / width));
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.max(1, Math.round((width * maxHeight) / height));
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        try {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          // White background to handle transparent PNGs / SVGs cleanly for JPEG compression
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          const compressed = canvas.toDataURL('image/jpeg', quality);
          if (compressed && compressed.startsWith('data:image/jpeg') && compressed.length > 25) {
            done(compressed);
            return;
          }
        } catch {
          // Canvas tainted or encoding failed; fall through
        }
      }

      if (typeof input === 'string' && /^data:image\/(jpeg|png|webp);/i.test(input)) {
        done(input);
      } else {
        done('');
      }
    };

    img.onerror = () => {
      if (typeof input !== 'string') {
        const type = (input.type || '').toLowerCase();
        if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') {
          const reader = new FileReader();
          reader.onload = () => done((reader.result as string) || '');
          reader.onerror = () => done('');
          reader.readAsDataURL(input);
        } else {
          done('');
        }
      } else if (/^data:image\/(jpeg|png|webp);/i.test(input)) {
        done(input);
      } else {
        done('');
      }
    };

    img.src = url;
  });
}

