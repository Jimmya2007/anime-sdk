import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

function parseM3U8(content: string, baseUrl: string): string[] {
  const lines = content.split('\n').map(line => line.trim());
  const urls: string[] = [];
  for (let line of lines) {
    if (line && !line.startsWith('#')) {
      try {
        urls.push(new URL(line, baseUrl).toString());
      } catch (e) {
        urls.push(line);
      }
    }
  }
  return urls;
}

interface Segment {
  url: string;
  duration: number;
}

function parseSegments(playlistText: string, playlistUrl: string): Segment[] {
  const lines = playlistText.split('\n').map(line => line.trim());
  const segments: Segment[] = [];
  let currentDuration = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXTINF:')) {
      const durationMatch = line.match(/#EXTINF:([0-9.]+)/);
      if (durationMatch) {
        currentDuration = parseFloat(durationMatch[1]);
      }
    } else if (line && !line.startsWith('#')) {
      try {
        segments.push({
          url: new URL(line, playlistUrl).toString(),
          duration: currentDuration
        });
      } catch (e) {
        segments.push({
          url: line,
          duration: currentDuration
        });
      }
    }
  }
  return segments;
}

function stripPngHeader(buffer: Buffer): Buffer {
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(pngMagic)) {
    const iendMagic = Buffer.from([0x49, 0x45, 0x4e, 0x44]);
    const iendIndex = buffer.indexOf(iendMagic);
    if (iendIndex !== -1) {
      // Skip the 'IEND' magic (4 bytes) + CRC (4 bytes)
      const dataOffset = iendIndex + 8;
      if (dataOffset < buffer.length) {
        console.log(`[Screenshot Helper] Found PNG-wrapped segment. Stripped ${dataOffset} bytes.`);
        return buffer.subarray(dataOffset);
      }
    }
  }
  return buffer;
}

/**
 * Capture a screenshot from a direct video stream URL (.mp4, .m3u8, etc.) using ffmpeg.
 * If the URL is an HLS playlist, it downloads and strips PNG wrapper headers from the segment.
 *
 * @throws {Error} if the screenshot cannot be captured for any reason.
 */
export async function captureStreamScreenshot(providerId: string, sourceUrl: string, headers: Record<string, string> = {}): Promise<string> {
  const localDir = path.resolve(process.cwd(), 'scratch/screenshots');
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }

  const outputFilename = `screenshot_${providerId}.png`;
  const outputPath = path.join(localDir, outputFilename);

  let targetUrl = sourceUrl;
  console.log(`[Screenshot Helper] Initial sourceUrl: ${sourceUrl}`);

  // If the URL is an HTML page, fetch it to extract direct stream URL
  const isDirect = sourceUrl.includes('.mp4') || sourceUrl.includes('.m3u8') || sourceUrl.includes('media-source');
  if (!isDirect) {
    console.log(`[Screenshot Helper] URL does not look direct. Fetching page to extract stream link...`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const fetchHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (headers.Referer) {
      fetchHeaders.Referer = headers.Referer;
    } else if (headers.referer) {
      fetchHeaders.Referer = headers.referer;
    }

    const res = await fetch(sourceUrl, { headers: fetchHeaders, signal: controller.signal });
    clearTimeout(timer);
    const html = await res.text();

    // Search for .m3u8 or .mp4 patterns
    const regex = /(https?:\/\/[^"'\s<>]+?\.m3u8[^"'\s<>]*|https?:\/\/[^"'\s<>]+?\.mp4[^"'\s<>]*)/i;
    const match = html.match(regex);
    if (match) {
      targetUrl = match[1].replace(/&amp;/g, '&');
      console.log(`[Screenshot Helper] Extracted direct stream URL: ${targetUrl}`);
    } else {
      // Try unescaped slashes (e.g. \/)
      const unescapedHtml = html.replace(/\\\/|\\/g, '/');
      const matchUnescaped = unescapedHtml.match(regex);
      if (matchUnescaped) {
        targetUrl = matchUnescaped[1];
        console.log(`[Screenshot Helper] Extracted direct stream URL (unescaped): ${targetUrl}`);
      } else {
        throw new Error(`[Screenshot Helper] No direct video stream URL found in page HTML for ${sourceUrl}`);
      }
    }
  }

  // Prepare fetch headers
  const fetchHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...headers
  };

  // If targetUrl contains .m3u8, process it via our custom segment extractor
  if (targetUrl.includes('.m3u8')) {
    console.log(`[Screenshot Helper] Processing HLS stream: ${targetUrl}`);
    // Fetch playlist
    let playlistRes = await fetch(targetUrl, { headers: fetchHeaders });
    if (!playlistRes.ok) {
      throw new Error(`Failed to fetch playlist: ${playlistRes.status} ${playlistRes.statusText}`);
    }
    let playlistText = await playlistRes.text();
    let currentPlaylistUrl = targetUrl;

    // If it's a master playlist, fetch the actual sub-playlist
    if (playlistText.includes('#EXT-X-STREAM-INF')) {
      const subPlaylists = parseM3U8(playlistText, targetUrl);
      if (subPlaylists.length === 0) {
        throw new Error(`Master playlist does not contain any sub-playlists`);
      }
      // Pick the highest quality / last sub-playlist
      currentPlaylistUrl = subPlaylists[subPlaylists.length - 1];
      console.log(`[Screenshot Helper] Master playlist detected. Selected sub-playlist: ${currentPlaylistUrl}`);
      playlistRes = await fetch(currentPlaylistUrl, { headers: fetchHeaders });
      if (!playlistRes.ok) {
        throw new Error(`Failed to fetch sub-playlist: ${playlistRes.status} ${playlistRes.statusText}`);
      }
      playlistText = await playlistRes.text();
    }

    // Parse segments
    const segments = parseSegments(playlistText, currentPlaylistUrl);
    if (segments.length === 0) {
      throw new Error(`No segments found in playlist`);
    }

    // Pick segment around 5 seconds
    let targetSegment = segments[0];
    let accumulatedTime = 0;
    const targetTime = 5;
    for (const seg of segments) {
      if (accumulatedTime + seg.duration >= targetTime) {
        targetSegment = seg;
        break;
      }
      accumulatedTime += seg.duration;
    }

    console.log(`[Screenshot Helper] Selected segment URL: ${targetSegment.url}`);

    // Fetch segment bytes
    const segmentRes = await fetch(targetSegment.url, { headers: fetchHeaders });
    if (!segmentRes.ok) {
      throw new Error(`Failed to fetch segment: ${segmentRes.status} ${segmentRes.statusText}`);
    }

    const arrayBuffer = await segmentRes.arrayBuffer();
    let segmentBuffer = Buffer.from(arrayBuffer);

    // Strip PNG header if present
    segmentBuffer = stripPngHeader(segmentBuffer) as unknown as Buffer<ArrayBuffer>;

    // Save segment to temporary file
    const tempSegmentPath = path.join(localDir, `temp_${providerId}_segment.ts`);
    fs.writeFileSync(tempSegmentPath, segmentBuffer);

    // Run ffmpeg locally on the extracted segment file
    console.log(`[Screenshot Helper] Running ffmpeg on local segment: ${tempSegmentPath}`);

    // Since the segment contains the video, extract a frame from 2 seconds into the segment (or 0 if segment is shorter)
    const seekTime = targetSegment.duration > 2 ? '00:00:02' : '00:00:00';
    const cmd = `ffmpeg -y -ss ${seekTime} -i "${tempSegmentPath}" -frames:v 1 -q:v 2 "${outputPath}"`;
    execSync(cmd, { stdio: 'pipe', timeout: 25000 });

    // Clean up temporary file
    try {
      fs.unlinkSync(tempSegmentPath);
    } catch (e) {}

    if (!fs.existsSync(outputPath)) {
      throw new Error(`ffmpeg ran but screenshot file was not created at: ${outputPath}`);
    }

    console.log(`[Screenshot Helper] Successfully saved HLS segment screenshot to: ${outputPath}`);
    return outputPath;
  }

  // Fallback: capture frame directly from the URL using ffmpeg network input
  console.log(`[Screenshot Helper] Running fallback direct ffmpeg on: ${targetUrl}`);

  let headerArg = '';
  if (Object.keys(headers).length > 0) {
    const headerLines = Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n') + '\r\n';
    headerArg = `-headers "${headerLines.replace(/"/g, '\\"')}"`;
  }

  // Add HLS segment extension ignore flags if it's HLS
  const allowedExtensions = targetUrl.includes('.m3u8') ? '-allowed_segment_extensions ALL' : '';
  const cmd = `ffmpeg -y ${allowedExtensions} ${headerArg} -ss 00:00:05 -i "${targetUrl}" -frames:v 1 -q:v 2 "${outputPath}"`;
  execSync(cmd, { stdio: 'pipe', timeout: 25000 });

  if (!fs.existsSync(outputPath)) {
    throw new Error(`ffmpeg ran but screenshot file was not created at: ${outputPath}`);
  }

  console.log(`[Screenshot Helper] Successfully saved direct stream screenshot to: ${outputPath}`);
  return outputPath;
}
