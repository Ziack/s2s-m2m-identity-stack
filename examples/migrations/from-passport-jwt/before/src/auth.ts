import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import type { Request, Response, NextFunction } from 'express';

export interface JwtPayload {
  sub: string;
  roles?: string[];
}

passport.use(
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET ?? 'dev-secret',
    },
    (payload: JwtPayload, done) => done(null, payload),
  ),
);

export const requireJwt = passport.authenticate('jwt', { session: false });

export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as JwtPayload | undefined;
    if (user?.roles?.includes(role)) {
      return next();
    }
    return res.status(403).json({ error: 'forbidden' });
  };
}
