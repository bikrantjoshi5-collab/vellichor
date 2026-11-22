import type { PluginBundleStore } from '@/plugins/repoSync';
import { assertSafePluginId } from '@/plugins/security';
import type { AssetFileStore } from './downloadEngine';

function getExpoFs() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-file-system') as typeof import('expo-file-system');
}

function guessImageExt(url: string, contentType?: string): string {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.png')) return 'png';
  if (clean.endsWith('.webp')) return 'webp';
  if (clean.endsWith('.gif')) return 'gif';
  return 'jpg';
}

export function createExpoAssetStore(): AssetFileStore {
  return {
    async writeChapterContent(novelId, chapterId, json) {
      const FileSystem = getExpoFs();
      const assetsDir = `${FileSystem.documentDirectory}chapters/${novelId}/${chapterId}`;
      await FileSystem.makeDirectoryAsync(assetsDir, { intermediates: true });
      const contentPath = `${assetsDir}/content.json`;
      await FileSystem.writeAsStringAsync(contentPath, json);
      return { contentPath, assetsDir };
    },

    async downloadIllustration(novelId, chapterId, index, url, headers) {
      const FileSystem = getExpoFs();
      const assetsDir = `${FileSystem.documentDirectory}chapters/${novelId}/${chapterId}`;
      await FileSystem.makeDirectoryAsync(assetsDir, { intermediates: true });
      const ext = guessImageExt(url);
      const target = `${assetsDir}/img_${index}.${ext}`;
      const result = await FileSystem.downloadAsync(url, target, { headers });

      const contentType =
        result.headers?.['Content-Type'] ?? result.headers?.['content-type'] ?? '';
      const isHtmlError = contentType.toLowerCase().includes('text/html');

      if (result.status < 200 || result.status >= 300 || isHtmlError) {
        await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
        throw new Error(
          isHtmlError
            ? `Rejected non-image response (${contentType}) for illustration`
            : `HTTP ${result.status} downloading illustration`
        );
      }
      return result.uri;
    },

    async deleteDirectory(dirPath) {
      const FileSystem = getExpoFs();
      const info = await FileSystem.getInfoAsync(dirPath);
      if (info.exists) {
        await FileSystem.deleteAsync(dirPath, { idempotent: true });
      }
    },
  };
}

export function createExpoPluginBundleStore(): PluginBundleStore {
  return {
    async writeBundle(pluginId, code) {
      const safeId = assertSafePluginId(pluginId);
      const FileSystem = getExpoFs();
      const dir = `${FileSystem.documentDirectory}plugins`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const filePath = `${dir}/${safeId}.js`;
      await FileSystem.writeAsStringAsync(filePath, code);
      return filePath;
    },
    async readBundle(localPath) {
      const FileSystem = getExpoFs();
      return FileSystem.readAsStringAsync(localPath);
    },
    async deleteBundle(localPath) {
      const FileSystem = getExpoFs();
      await FileSystem.deleteAsync(localPath, { idempotent: true });
    },
  };
}

export async function readChapterBlocksFromDisk(contentPath: string): Promise<string> {
  const FileSystem = getExpoFs();
  return FileSystem.readAsStringAsync(contentPath);
}
