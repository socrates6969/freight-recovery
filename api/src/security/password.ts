/**
 * Password hashing with argon2id. Verification does constant work: unknown or disabled accounts are
 * verified against a precomputed dummy hash so response timing does not reveal account existence.
 */
import argon2 from 'argon2';

export interface Argon2Params {
  memoryKib: number;
  timeCost: number;
}

const PARALLELISM = 1;
const DUMMY_SECRET = 'freight-recovery-dummy-password-for-constant-work';

export class PasswordHasher {
  private dummyHash: Promise<string> | null = null;

  constructor(private readonly params: Argon2Params) {}

  hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.params.memoryKib,
      timeCost: this.params.timeCost,
      parallelism: PARALLELISM,
    });
  }

  /** Verify; never throws for malformed hashes (returns false). */
  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** Burn the same work as a real verification (unknown/disabled user). Always resolves false. */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash(DUMMY_SECRET);
    await this.verify(await this.dummyHash, password);
    return false;
  }

  /** True when the stored hash used different parameters than the current policy. */
  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, {
        memoryCost: this.params.memoryKib,
        timeCost: this.params.timeCost,
        parallelism: PARALLELISM,
      });
    } catch {
      return true;
    }
  }
}
