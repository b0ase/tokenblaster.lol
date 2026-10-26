import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPhoneDevice, openInBwalletBrowserUrl, phoneRows, showQrPanel } from './pair/phoneUi';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

test('phone detection: phone UAs, or touch with a narrow screen', () => {
  assert.equal(isPhoneDevice(IPHONE), true);
  assert.equal(isPhoneDevice(ANDROID), true);
  assert.equal(isPhoneDevice('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'), true);
  assert.equal(isPhoneDevice(MAC), false);
  assert.equal(isPhoneDevice(MAC, true, 390), true); // iPadOS desktop-mode UA / unknown touch phone
  assert.equal(isPhoneDevice(MAC, true, 1440), false); // touch laptop
  assert.equal(isPhoneDevice(MAC, false, 390), false); // narrow desktop window
});

test('no QR on a phone UA; QR on a computer', () => {
  assert.equal(showQrPanel(isPhoneDevice(IPHONE)), false);
  assert.equal(showQrPanel(isPhoneDevice(ANDROID)), false);
  assert.equal(showQrPanel(isPhoneDevice(MAC)), true);
});

test("phone option order: Open in bWallet's browser first, then bWallet on your phone", () => {
  assert.deepEqual(phoneRows(false), ['open-in-browser', 'phone-link', 'get', 'web']);
  assert.deepEqual(phoneRows(true), ['in-app', 'open-in-browser', 'phone-link', 'get', 'web']);
  assert.ok(phoneRows(false).indexOf('open-in-browser') < phoneRows(false).indexOf('phone-link'));
});

test('dapp-browser link carries the page URL', () => {
  const u = openInBwalletBrowserUrl('https://www.tokenblaster.lol/arcade?x=1');
  assert.equal(u, 'https://www.bwallet.space/browse?url=https%3A%2F%2Fwww.tokenblaster.lol%2Farcade%3Fx%3D1');
});
