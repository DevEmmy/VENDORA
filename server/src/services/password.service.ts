import argon2 from "argon2";
import { HttpError } from "../middleware/error-handler";
import { passwordProblem } from './password-policy';

const options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
// A bounded queue is deliberately avoided: reject overload before allocating hashing work.
export class Passwords {
  private active = 0;
  private dummy: Promise<string>;
  constructor() {
    this.dummy = argon2.hash("unused dummy password for timing", options);
  }
  private async bounded<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= 4) throw new HttpError(429, "Please try again later");
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
    }
  }
  async validate(password: string) {
    const problem = passwordProblem(password);
    if (problem) throw new HttpError(400, problem);
  }

  hash(password: string) {
    return this.bounded(() => argon2.hash(password, options));
  }
  async verify(hash: string | undefined, password: string) {
    return this.bounded(async () => {
      const valid = await argon2.verify(hash ?? (await this.dummy), password);
      return Boolean(hash) && valid;
    });
  }
  needsRehash(hash: string) {
    return argon2.needsRehash(hash, options);
  }
}
