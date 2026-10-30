import {emptyData, validateBackup} from './model.js';
export class JournalStore {
  constructor(storage, key) { this.storage=storage; this.key=key; this.raw=null; this.locked=false; }
  load() {
    try {
      this.raw=this.storage.getItem(this.key);
      return this.raw === null ? emptyData() : validateBackup(JSON.parse(this.raw));
    } catch {
      this.locked=true;
      throw new Error('Your saved journal could not be read. Writes are blocked to protect it. Download the raw recovery file before changing browser storage.');
    }
  }
  save(value) {
    if (this.locked) throw new Error('Journal writes are blocked until saved data is recovered.');
    const clean=validateBackup(value);
    if (this.storage.getItem(this.key) !== this.raw) throw new Error('Another tab changed your journal. Reload this page before saving; your current draft will stay here.');
    const next=JSON.stringify(clean);
    this.storage.setItem(this.key,next);
    this.raw=next;
    return clean;
  }
}
