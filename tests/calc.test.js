// Kiểm thử công thức: node --test tests/
const test = require('node:test'), assert = require('node:assert');
const C = require('../calc.js');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≉ ${b} (±${tol})`);
test('giờ phút', () => {
  assert.equal(C.parseHM('1:30'), 90); assert.equal(C.parseHM('0130'), 90); assert.equal(C.parseHM('1,5'), 90); assert.equal(C.parseHM('2'), 120);
  assert.equal(C.parseHM('-0:45'), -45); assert.ok(isNaN(C.parseHM('1:75'))); assert.equal(C.parseHM('2h15'), 135);
  assert.equal(C.sumHM([{ op: '+', v: '1:45' }, { op: '+', v: '2:30' }, { op: '-', v: '0:20' }]), 235);
  assert.equal(C.fmtHM(235), '3:55'); assert.equal(C.fmtHM(-75), '−1:15'); assert.equal(C.fmtHM(1500, { wrap: true, pad: true }), '01:00');
  assert.equal(C.minToDec(90), 1.5); assert.equal(C.decToMin(2.25), 135); assert.equal(C.minToDec(100), 1.67);
  assert.equal(C.flightTimeMin(240, 480), 30);
});
test('múi giờ', () => {
  assert.equal(C.tzOffsetMin('Asia/Ho_Chi_Minh', new Date('2026-11-01T00:00:00Z')), 420);
  assert.equal(C.tzOffsetMin('America/New_York', new Date('2026-07-01T00:00:00Z')), -240);
  assert.equal(C.tzOffsetMin('America/New_York', new Date('2026-12-01T00:00:00Z')), -300);
  assert.equal(C.tzOffsetMin('Asia/Kolkata', new Date('2026-12-01T00:00:00Z')), 330);
  assert.equal(C.fmtOffset(330), 'UTC+5:30');
});
test('đơn vị', () => {
  near(C.convert('len', 1000, 'ft', 'm'), 304.8, 1e-9); near(C.convert('spd', 100, 'kt', 'kmh'), 185.2, 1e-9);
  near(C.convert('spd', 100, 'kt', 'mph'), 115.078, 1e-3); near(C.convert('spd', 100, 'kt', 'ms'), 51.4444, 1e-4);
  near(C.convert('dist', 1, 'NM', 'km'), 1.852, 1e-12); near(C.convert('dist', 1, 'SM', 'NM'), 0.868976, 1e-6);
  near(C.convert('press', 29.92, 'inHg', 'hPa'), 1013.2, 0.1); near(C.convert('press', 1013.25, 'hPa', 'inHg'), 29.921, 1e-3);
  near(C.convert('temp', 100, 'C', 'F'), 212, 1e-9); near(C.convert('temp', -40, 'F', 'C'), -40, 1e-9);
  near(C.convert('mass', 1, 'kg', 'lb'), 2.20462, 1e-5); near(C.convert('vol', 1, 'USgal', 'L'), 3.785411784, 1e-12);
  const f = C.fuel(1000, 'L', 0.8); near(f.kg, 800, 1e-9); near(f.lb, 1763.7, 0.1); near(f.USgal, 264.17, 0.01);
  near(C.fuel(800, 'kg', 0.8).L, 1000, 1e-9);
});
test('ISA, cao độ áp suất & mật độ', () => {
  near(C.pressureAltitude(0, 1013.25), 0, 1e-6); near(C.pressureAltitude(0, 1003), 281, 3, 'QNH 1003');
  near(C.pressureAltitude(1000, 1023), 735, 3, 'QNH 1023 (~27 ft/hPa)'); near(C.isaTempC(10000), -4.8, 0.05);
  near(C.densityAltitude(5000, C.isaTempC(5000)), 5000, 1, 'ISA ⇒ DA=PA'); near(C.densityAltitude(0, 15), 0, 1);
  near(C.densityAltitude(5000, 30), 7801, 15, 'PA5000 30°C (tính tay ISA)'); near(C.densityAltitudeRule(5000, 30), 7958, 5, 'quy tắc 118,8 ft/°C'); near(C.densityAltitude(0, 35), 2300, 120, 'Mực biển 35°C');
});
test('TAS/CAS', () => {
  near(C.casToTas(250, 10000).tas, 288.5, 1.5, 'CAS250 FL100 ISA'); near(C.casToTas(100, 0).tas, 100, 0.01);
  near(C.casToTas(300, 35000).mach, 0.874, 0.005, 'CAS300 FL350'); near(C.tasToCas(C.casToTas(180, 8000, 20).tas, 8000, 20).cas, 180, 1e-6);
});
test('gió thành phần & tốc độ hạ', () => {
  const w = C.windComponents(300, 20, 270); near(w.head, 17.32, 0.01); near(w.cross, 10, 1e-9);
  const t = C.windComponents(90, 10, 270); near(t.head, -10, 1e-9);
  near(C.descentGradient(3), 318.4, 0.5); near(C.descentRate(140, 3), 743, 2); near(C.descentRate(120, 3), 637, 2);
});
