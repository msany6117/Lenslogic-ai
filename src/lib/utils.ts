import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function compressImage(base64Str: string, maxWidth = 300, maxHeight = 300, quality = 0.7): Promise<string> {
  return new Promise((resolve) => {
    if (!base64Str || base64Str.startsWith('blob:')) {
      resolve(base64Str);
      return;
    }
    const match = base64Str.match(/^data:(image\/[a-z0-9-+.]+);base64,/);
    const mimeType = match ? match[1] : 'image/jpeg';

    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, width, height);

        if (mimeType === 'image/jpeg') {
          // Fill white background for JPEG to handle transparency beautifully
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
        }

        ctx.drawImage(img, 0, 0, width, height);

        if (mimeType === 'image/png' || mimeType === 'image/webp') {
          const webpData = canvas.toDataURL('image/webp', quality);
          if (webpData.startsWith('data:image/webp')) {
            resolve(webpData);
          } else {
            resolve(canvas.toDataURL('image/jpeg', quality));
          }
        } else {
          resolve(canvas.toDataURL('image/jpeg', quality));
        }
      } else {
        resolve(base64Str);
      }
    };
    img.onerror = () => {
      resolve(base64Str);
    };
  });
}

/**
 * Superfast client-side image compression that decodes natively in the browser.
 * Accepts File, Blob, blob: URL, or existing base64 string and returns a compressed JPEG data URL.
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

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
        
        // White background to handle transparent PNGs / SVGs
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        
        ctx.drawImage(img, 0, 0, width, height);

        const compressed = canvas.toDataURL('image/jpeg', quality);
        if (shouldRevoke) {
          URL.revokeObjectURL(url);
        }
        resolve(compressed);
      } else {
        if (shouldRevoke) {
          URL.revokeObjectURL(url);
        }
        resolve(typeof input === 'string' ? input : '');
      }
    };

    img.onerror = () => {
      if (shouldRevoke) {
        URL.revokeObjectURL(url);
      }
      if (typeof input !== 'string') {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string || '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(input);
      } else {
        resolve(input);
      }
    };

    img.src = url;
  });
}

