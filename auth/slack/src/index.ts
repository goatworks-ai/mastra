import { MastraAuthProvider } from '@mastra/core/server';
import type { MastraAuthProviderOptions } from '@mastra/core/server';
import type { HonoRequest } from 'hono';
import { WebClient } from '@slack/web-api';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SlackUser {
  /** The Slack user ID */
  id: string;
  /** The Slack team/workspace ID */
  team_id: string;
  /** The user's display name */
  name: string;
  /** The user's real name */
  real_name?: string;
  /** The user's email address */
  email?: string;
  /** Whether this is a bot user */
  is_bot: boolean;
  /** Whether this is an admin */
  is_admin?: boolean;
  /** Whether this is an owner */
  is_owner?: boolean;
  /** Profile information */
  profile?: {
    display_name?: string;
    email?: string;
    image_48?: string;
    image_72?: string;
  };
}

export interface SlackWebhookPayload {
  /** The type of Slack event */
  type: string;
  /** Token for verification (deprecated, use signing secret instead) */
  token?: string;
  /** Challenge string for URL verification */
  challenge?: string;
  /** Team ID */
  team_id?: string;
  /** API app ID */
  api_app_id?: string;
  /** Event details */
  event?: {
    type: string;
    user?: string;
    channel?: string;
    text?: string;
    ts?: string;
    [key: string]: unknown;
  };
  /** Event time */
  event_time?: number;
}

interface MastraAuthSlackOptions extends MastraAuthProviderOptions<SlackUser> {
  /** Slack Bot Token (xoxb-...) for API calls */
  botToken?: string;
  /** Slack Signing Secret for webhook verification */
  signingSecret?: string;
  /** Slack Client ID for OAuth */
  clientId?: string;
  /** Slack Client Secret for OAuth */
  clientSecret?: string;
  /** Optional: Restrict to specific team IDs */
  allowedTeamIds?: string[];
  /** Mode: 'webhook' for verifying webhook signatures, 'oauth' for user tokens */
  mode?: 'webhook' | 'oauth' | 'both';
}

/**
 * Mastra Auth Provider for Slack integration.
 *
 * Supports two modes:
 * 1. Webhook mode: Verifies Slack webhook signatures using the signing secret
 * 2. OAuth mode: Verifies user tokens using the Slack Web API
 *
 * @example
 * ```typescript
 * const auth = new MastraAuthSlack({
 *   signingSecret: process.env.SLACK_SIGNING_SECRET,
 *   botToken: process.env.SLACK_BOT_TOKEN,
 *   mode: 'both',
 * });
 * ```
 */
export class MastraAuthSlack extends MastraAuthProvider<SlackUser> {
  protected signingSecret?: string;
  protected botToken?: string;
  protected clientId?: string;
  protected clientSecret?: string;
  protected allowedTeamIds?: string[];
  protected mode: 'webhook' | 'oauth' | 'both';
  protected client?: WebClient;

  constructor(options?: MastraAuthSlackOptions) {
    super({ name: options?.name ?? 'slack' });

    const signingSecret = options?.signingSecret ?? process.env.SLACK_SIGNING_SECRET;
    const botToken = options?.botToken ?? process.env.SLACK_BOT_TOKEN;
    const clientId = options?.clientId ?? process.env.SLACK_CLIENT_ID;
    const clientSecret = options?.clientSecret ?? process.env.SLACK_CLIENT_SECRET;

    this.mode = options?.mode ?? 'both';
    this.signingSecret = signingSecret;
    this.botToken = botToken;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.allowedTeamIds = options?.allowedTeamIds;

    // Validate required credentials based on mode
    if (this.mode === 'webhook' || this.mode === 'both') {
      if (!signingSecret) {
        throw new Error(
          'Slack signing secret is required for webhook mode. Provide it via options.signingSecret or SLACK_SIGNING_SECRET environment variable.',
        );
      }
    }

    if (this.mode === 'oauth' || this.mode === 'both') {
      if (!botToken) {
        throw new Error(
          'Slack bot token is required for OAuth mode. Provide it via options.botToken or SLACK_BOT_TOKEN environment variable.',
        );
      }
    }

    // Initialize Web Client if we have a bot token
    if (botToken) {
      this.client = new WebClient(botToken);
    }

    this.registerOptions(options);
  }

  /**
   * Verifies a Slack webhook signature.
   *
   * @see https://api.slack.com/authentication/verifying-requests-from-slack
   */
  verifyWebhookSignature(
    signature: string,
    timestamp: string,
    body: string,
  ): boolean {
    if (!this.signingSecret) {
      return false;
    }

    // Check timestamp to prevent replay attacks (must be within 5 minutes)
    const currentTime = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp, 10);
    if (Math.abs(currentTime - requestTime) > 60 * 5) {
      return false;
    }

    // Compute expected signature
    const sigBasestring = `v0:${timestamp}:${body}`;
    const mySignature = 'v0=' + createHmac('sha256', this.signingSecret)
      .update(sigBasestring, 'utf8')
      .digest('hex');

    // Use timing-safe comparison
    try {
      return timingSafeEqual(
        Buffer.from(mySignature, 'utf8'),
        Buffer.from(signature, 'utf8'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Authenticates a request from Slack.
   *
   * For webhook requests: Verifies the X-Slack-Signature header
   * For OAuth requests: Verifies the Bearer token using Slack's auth.test API
   */
  async authenticateToken(token: string, request: HonoRequest): Promise<SlackUser | null> {
    // Check if this is a webhook request (has Slack signature headers)
    const slackSignature = request.header('x-slack-signature');
    const slackTimestamp = request.header('x-slack-request-timestamp');

    if (slackSignature && slackTimestamp && (this.mode === 'webhook' || this.mode === 'both')) {
      return this.authenticateWebhook(slackSignature, slackTimestamp, request);
    }

    // Otherwise, treat as OAuth token verification
    if (token && (this.mode === 'oauth' || this.mode === 'both')) {
      return this.authenticateOAuthToken(token);
    }

    return null;
  }

  /**
   * Authenticate a Slack webhook request.
   */
  private async authenticateWebhook(
    signature: string,
    timestamp: string,
    request: HonoRequest,
  ): Promise<SlackUser | null> {
    try {
      // Get the raw body for signature verification
      const body = await request.text();

      if (!this.verifyWebhookSignature(signature, timestamp, body)) {
        console.error('Slack webhook signature verification failed');
        return null;
      }

      // Parse the body to extract user info
      const payload: SlackWebhookPayload = JSON.parse(body);

      // Handle URL verification challenge
      if (payload.type === 'url_verification') {
        // Return a special user object for URL verification
        return {
          id: 'slack-verification',
          team_id: payload.team_id ?? 'unknown',
          name: 'URL Verification',
          is_bot: true,
        };
      }

      // For event callbacks, extract user info from the event
      if (payload.type === 'event_callback' && payload.event) {
        const userId = payload.event.user;
        if (userId && this.client) {
          try {
            const userInfo = await this.client.users.info({ user: userId });
            if (userInfo.ok && userInfo.user) {
              return {
                id: userInfo.user.id!,
                team_id: userInfo.user.team_id ?? payload.team_id ?? 'unknown',
                name: userInfo.user.name ?? 'unknown',
                real_name: userInfo.user.real_name,
                is_bot: userInfo.user.is_bot ?? false,
                is_admin: userInfo.user.is_admin,
                is_owner: userInfo.user.is_owner,
                profile: userInfo.user.profile as SlackUser['profile'],
              };
            }
          } catch (err) {
            console.error('Failed to fetch Slack user info:', err);
          }
        }

        // Return basic user info if we couldn't fetch details
        return {
          id: userId ?? 'unknown',
          team_id: payload.team_id ?? 'unknown',
          name: 'Slack User',
          is_bot: false,
        };
      }

      // For other webhook events, return app info
      return {
        id: payload.api_app_id ?? 'unknown',
        team_id: payload.team_id ?? 'unknown',
        name: 'Slack App',
        is_bot: true,
      };
    } catch (err) {
      console.error('Slack webhook authentication failed:', err);
      return null;
    }
  }

  /**
   * Authenticate a Slack OAuth user token.
   */
  private async authenticateOAuthToken(token: string): Promise<SlackUser | null> {
    if (!token || typeof token !== 'string') {
      return null;
    }

    try {
      // Create a client with the user's token
      const userClient = new WebClient(token);
      const authResult = await userClient.auth.test();

      if (!authResult.ok || !authResult.user_id) {
        return null;
      }

      // Fetch full user info using the bot token (if available) or user token
      const client = this.client ?? userClient;
      const userInfo = await client.users.info({ user: authResult.user_id });

      if (!userInfo.ok || !userInfo.user) {
        // Return basic info from auth.test if user.info fails
        return {
          id: authResult.user_id,
          team_id: authResult.team_id ?? 'unknown',
          name: authResult.user ?? 'unknown',
          is_bot: authResult.bot_id !== undefined,
        };
      }

      return {
        id: userInfo.user.id!,
        team_id: userInfo.user.team_id ?? authResult.team_id ?? 'unknown',
        name: userInfo.user.name ?? authResult.user ?? 'unknown',
        real_name: userInfo.user.real_name,
        email: userInfo.user.profile?.email,
        is_bot: userInfo.user.is_bot ?? false,
        is_admin: userInfo.user.is_admin,
        is_owner: userInfo.user.is_owner,
        profile: userInfo.user.profile as SlackUser['profile'],
      };
    } catch (err) {
      console.error('Slack OAuth token verification failed:', err);
      return null;
    }
  }

  /**
   * Authorize a Slack user.
   *
   * Checks:
   * 1. User exists and has valid ID
   * 2. Team ID is in allowed list (if configured)
   */
  async authorizeUser(user: SlackUser): Promise<boolean> {
    if (!user || !user.id) {
      return false;
    }

    // Skip team validation for URL verification requests
    if (user.id === 'slack-verification') {
      return true;
    }

    // Check team restrictions if configured
    if (this.allowedTeamIds && this.allowedTeamIds.length > 0) {
      if (!this.allowedTeamIds.includes(user.team_id)) {
        console.error(`Slack user from team ${user.team_id} not in allowed teams`);
        return false;
      }
    }

    return true;
  }

  /**
   * Get the Slack Web API client.
   */
  getClient(): WebClient | undefined {
    return this.client;
  }

  /**
   * Exchange an OAuth code for tokens.
   *
   * @param code The OAuth authorization code
   * @param redirectUri The redirect URI used in the OAuth flow
   * @returns The OAuth access response
   */
  async exchangeCodeForToken(code: string, redirectUri?: string): Promise<{
    ok: boolean;
    access_token?: string;
    token_type?: string;
    scope?: string;
    bot_user_id?: string;
    app_id?: string;
    team?: { id?: string; name?: string };
    authed_user?: {
      id?: string;
      scope?: string;
      access_token?: string;
      token_type?: string;
    };
    error?: string;
  }> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'Slack client ID and secret are required for OAuth code exchange. Provide them via options or environment variables.',
      );
    }

    const tempClient = new WebClient();
    const result = await tempClient.oauth.v2.access({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: redirectUri,
    });

    return result as {
      ok: boolean;
      access_token?: string;
      token_type?: string;
      scope?: string;
      bot_user_id?: string;
      app_id?: string;
      team?: { id?: string; name?: string };
      authed_user?: {
        id?: string;
        scope?: string;
        access_token?: string;
        token_type?: string;
      };
      error?: string;
    };
  }
}

export type { MastraAuthSlackOptions };
