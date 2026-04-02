import { WeixinClient } from "../client/index.js";

export async function notify(
  text: string,
  opts?: { to?: string },
): Promise<void> {
  const client = new WeixinClient();
  const cred = await client.ensureLogin();
  const to = opts?.to || cred.userId;

  if (!to) {
    throw new Error(
      "未指定推送目标。请传入 opts.to 或确保登录凭证包含 userId",
    );
  }

  await client.send(to, text);
}
