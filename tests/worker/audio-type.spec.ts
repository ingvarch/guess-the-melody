import { describe, expect, it } from 'vitest';
import { detectAudioContentType } from '../../src/importer/audio-type';

function buf(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

describe('detectAudioContentType', () => {
  it('detects MP4/M4A via ftyp at offset 4', () => {
    // 4-byte size, then 'ftyp'
    const b = buf([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
    expect(detectAudioContentType(b, 'audio/whatever')).toBe('audio/mp4');
  });

  it('detects MP3 via ID3 tag', () => {
    expect(detectAudioContentType(buf([0x49, 0x44, 0x33, 4, 0, 0]), 'x')).toBe('audio/mpeg');
  });

  it('detects MP3 via MPEG frame sync', () => {
    expect(detectAudioContentType(buf([0xff, 0xfb, 0x90, 0x00]), 'x')).toBe('audio/mpeg');
  });

  it('falls back to the given content type when bytes are unrecognised', () => {
    expect(detectAudioContentType(buf([1, 2, 3, 4, 5, 6, 7, 8]), 'audio/ogg')).toBe('audio/ogg');
  });

  it('falls back on a buffer too short to sniff', () => {
    expect(detectAudioContentType(buf([0xff]), 'audio/mpeg')).toBe('audio/mpeg');
  });
});
