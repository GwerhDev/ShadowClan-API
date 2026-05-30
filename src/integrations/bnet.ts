import { apiUrl, bnetClient, bnetSecret } from '../config';
import type { BnetProfile } from '../types';

// passport-bnet has no @types package — declare minimal interface
interface BnetStrategyOptions {
  clientID: string;
  clientSecret: string;
  callbackURL: string;
  region: string;
  scope: string;
  state: boolean;
}

type DoneCallback = (err: Error | null, user?: BnetProfile | false) => void;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const BnetStrategy = require('passport-bnet').Strategy as new (
  options: BnetStrategyOptions,
  verify: (accessToken: string, refreshToken: string, profile: BnetProfile & { id: string; provider: string }, done: DoneCallback) => void,
) => unknown;

function createBnetStrategy(callbackPath: string): unknown {
  return new BnetStrategy(
    {
      clientID:    bnetClient,
      clientSecret: bnetSecret,
      callbackURL: `${apiUrl}/${callbackPath}/callback`,
      region:      'us',
      scope:       'openid',
      state:       true,
    },
    (_accessToken: string, _refreshToken: string, profile: { id: string; battletag: string; provider: string }, done: DoneCallback) => {
      process.nextTick(() => {
        try {
          const user: BnetProfile = {
            battlenetId: profile.id,
            battletag:   profile.battletag,
            provider:    profile.provider,
          };
          done(null, user);
        } catch (error) {
          done(error as Error);
        }
      });
    },
  );
}

export const loginBnet  = createBnetStrategy('login-bnet');
export const signupBnet = createBnetStrategy('signup-bnet');
