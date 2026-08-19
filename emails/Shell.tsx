import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';
import { APP_NAME } from '@/lib/config';
import { email, fonts, WIDTH } from './theme';

/**
 * The frame every email shares.
 *
 * `<Section>` and `<Row>` compile to real table elements, which is the only
 * layout Outlook's Word engine understands: it ignores flexbox, grid and
 * position outright. All CSS is inline for the same reason.
 *
 * The preheader is the first thing in the body, because without one the inbox
 * preview shows whatever text comes first, which is usually "View in browser".
 */
export interface ShellProps {
  preview: string;
  appUrl: string;
  unsubscribeUrl: string;
  reason: string;
  children: ReactNode;
}

export function Shell({ preview, appUrl, unsubscribeUrl, reason, children }: ShellProps) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: email.page, margin: 0, padding: '24px 0' }}>
        <Container
          style={{
            width: WIDTH,
            maxWidth: '100%',
            margin: '0 auto',
            backgroundColor: email.surface,
            borderRadius: 4,
            padding: '32px 32px 24px',
            fontFamily: fonts.body,
            color: email.text,
          }}
        >
          <Section style={{ backgroundColor: email.surface }}>
            <Link
              href={appUrl}
              style={{
                fontFamily: fonts.serif,
                fontSize: 20,
                color: email.heading,
                textDecoration: 'none',
                letterSpacing: '0.02em',
              }}
            >
              {/* The mark ships with its corners already flattened onto white.
                  A transparent PNG loses them against the background Outlook.com
                  and the Gmail app invert to. Empty alt because the name sits
                  right beside it, so a client with images off still reads Tend
                  once rather than twice. */}
              <Img
                src={`${appUrl}/email/mark.png`}
                width="28"
                height="28"
                alt=""
                style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 9 }}
              />
              <span style={{ verticalAlign: 'middle' }}>{APP_NAME}</span>
            </Link>
          </Section>

          {children}

          <Hr style={{ borderColor: email.rule, margin: '28px 0 16px' }} />

          <Section style={{ backgroundColor: email.surface }}>
            <Text style={{ fontSize: 12, lineHeight: '18px', color: email.textSoft, margin: 0 }}>
              {reason}{' '}
              <Link href={unsubscribeUrl} style={{ color: email.textSoft }}>
                Turn these off
              </Link>
              .
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/** A heading over a list. Olive, because that is the app's state colour. */
export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: email.heading,
        margin: '24px 0 8px',
      }}
    >
      {children}
    </Text>
  );
}

/** The one call to action. Square corners in Outlook beat shipping VML. */
export function Action({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ backgroundColor: email.surface, paddingTop: 24 }}>
      <Link
        href={href}
        style={{
          backgroundColor: email.action,
          color: email.actionText,
          borderRadius: 4,
          display: 'inline-block',
          fontSize: 14,
          fontWeight: 600,
          padding: '11px 20px',
          textDecoration: 'none',
        }}
      >
        {children}
      </Link>
    </Section>
  );
}
