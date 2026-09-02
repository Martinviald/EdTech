import { firstForwardedIp } from './telemetry.interceptor';

describe('firstForwardedIp', () => {
  it('takes the first hop from a multi-proxy X-Forwarded-For', () => {
    expect(firstForwardedIp('203.0.113.7, 10.0.0.1, 10.0.0.2')).toBe('203.0.113.7');
  });

  it('trims surrounding whitespace', () => {
    expect(firstForwardedIp('  203.0.113.7  ')).toBe('203.0.113.7');
  });

  it('supports the header arriving as an array', () => {
    expect(firstForwardedIp(['203.0.113.7, 10.0.0.1'])).toBe('203.0.113.7');
  });

  it('returns undefined when missing or empty', () => {
    expect(firstForwardedIp(undefined)).toBeUndefined();
    expect(firstForwardedIp('')).toBeUndefined();
    expect(firstForwardedIp('   ')).toBeUndefined();
  });
});
