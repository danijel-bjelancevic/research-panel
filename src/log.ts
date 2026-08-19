import pc from 'picocolors';

export const log = {
  phase(title: string): void {
    console.log('\n' + pc.bold(pc.cyan(`━━ ${title} `.padEnd(64, '━'))));
  },
  seat(id: string, msg: string): void {
    console.log(`${pc.bold(pc.magenta(`[${id}]`))} ${msg}`);
  },
  moderator(msg: string): void {
    console.log(`${pc.bold(pc.blue('[moderator]'))} ${msg}`);
  },
  info(msg: string): void {
    console.log(pc.dim(msg));
  },
  plain(msg: string): void {
    console.log(msg);
  },
  warn(msg: string): void {
    console.warn(pc.yellow(`! ${msg}`));
  },
  error(msg: string): void {
    console.error(pc.red(`✖ ${msg}`));
  },
  success(msg: string): void {
    console.log(pc.green(`✔ ${msg}`));
  },
  cost(spentUsd: number, limitUsd: number): void {
    console.log(pc.dim(`   cost so far: $${spentUsd.toFixed(3)} / limit $${limitUsd.toFixed(2)}`));
  },
};
