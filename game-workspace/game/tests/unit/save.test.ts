import { describe, expect, it } from 'vitest';
import { SaveStore, defaultSave, parseSave, serializeSave } from '../../assets/scripts/core/save';
import { DEFAULT_CONFIG } from '../../assets/scripts/core/config';

const cfg = DEFAULT_CONFIG;

describe('SaveData 存档序列化与校验', () => {
  it('默认档结构完整', () => {
    expect(defaultSave()).toEqual({ v: 1, best: 0, games: 0, sound: true, haptics: true, tutorialDone: false });
  });

  it('序列化→解析 往返一致', () => {
    const s = { v: 1, best: 12, games: 5, sound: false, haptics: true, tutorialDone: true };
    expect(parseSave(serializeSave(s))).toEqual(s);
  });

  it('空档按默认处理', () => {
    expect(parseSave(null)).toEqual(defaultSave());
    expect(parseSave('')).toEqual(defaultSave());
  });

  it('坏档（截断 JSON）降级为默认档，不抛异常', () => {
    expect(parseSave('{"v":1,"best":')).toEqual(defaultSave());
    expect(parseSave('not-json-at-all')).toEqual(defaultSave());
  });

  it('字段类型错误/版本不识别一律降级，坏值不得渗入游戏', () => {
    expect(parseSave('{"v":1,"best":"很多","games":0,"sound":true,"haptics":true,"tutorialDone":false}')).toEqual(defaultSave());
    expect(parseSave('{"v":1,"best":-3,"games":0,"sound":true,"haptics":true,"tutorialDone":false}')).toEqual(defaultSave());
    expect(parseSave('{"v":999,"best":5,"games":0,"sound":true,"haptics":true,"tutorialDone":false}')).toEqual(defaultSave());
    expect(parseSave('{"v":1,"best":3}')).toEqual(defaultSave()); // 缺字段
  });

  it('SaveStore 读写走注入的 KVStore', () => {
    const backing = new Map<string, string>();
    const store = new SaveStore({ get: k => backing.get(k) ?? null, set: (k, v) => void backing.set(k, v) }, cfg);
    expect(store.load()).toEqual(defaultSave());
    const s = store.load();
    s.best = 7;
    s.sound = false;
    store.write(s);
    expect(JSON.parse(backing.get('save_v1')!)).toMatchObject({ best: 7, sound: false });
    expect(store.load().best).toBe(7);
  });

  it('存储抛异常时写入静默失败，不影响读取方', () => {
    const store = new SaveStore({ get: () => null, set: () => { throw new Error('quota'); } }, cfg);
    expect(() => store.write(defaultSave())).not.toThrow();
  });
});
