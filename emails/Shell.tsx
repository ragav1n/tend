import {
  Body,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
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
 *
 * `unsubscribeUrl` is optional because one email here is transactional. A
 * sign-in code has nothing to turn off: offering the switch would either lie or
 * lock somebody out of their own account.
 */
export interface ShellProps {
  preview: string;
  appUrl: string;
  unsubscribeUrl?: string;
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
              {reason}
              {unsubscribeUrl && (
                <>
                  {' '}
                  <Link href={unsubscribeUrl} style={{ color: email.textSoft }}>
                    Turn these off
                  </Link>
                  .
                </>
              )}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/**
 * The numbers, in a beige band across the top.
 *
 * Beige is a background here and nowhere else: it measures 2.1:1 on white, which
 * is unusable for text and right for a panel. Equal width cells rather than
 * anything that has to measure itself, because Word's engine does not.
 */
export function Stats({ items }: { items: { value: string; label: string }[] }) {
  const width = `${Math.round(100 / items.length)}%`;
  const last = items.length - 1;

  return (
    <Section style={{ backgroundColor: email.surface, paddingTop: 18 }}>
      <Row style={{ backgroundColor: email.tint, borderRadius: 4 }}>
        {items.map((stat, index) => (
          <Column
            key={stat.label}
            style={{
              backgroundColor: email.tint,
              padding: '14px 16px',
              verticalAlign: 'top',
              width,
              // The radius has to sit on the end cells, not on the row. Each cell
              // paints its own background over the row's corners, so a radius up
              // there rounds nothing and the band arrives square.
              ...(index === 0 ? { borderRadius: '4px 0 0 4px' } : {}),
              ...(index === last ? { borderRadius: '0 4px 4px 0' } : {}),
            }}
          >
            <Text
              style={{
                fontFamily: fonts.serif,
                fontSize: 24,
                lineHeight: '28px',
                color: email.heading,
                margin: 0,
              }}
            >
              {stat.value}
            </Text>
            <Text
              style={{
                fontSize: 11,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                lineHeight: '16px',
                color: email.textSoft,
                margin: '2px 0 0',
              }}
            >
              {stat.label}
            </Text>
          </Column>
        ))}
      </Row>
    </Section>
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

/**
 * The line above a heading, for an email whose subject is one task rather than a
 * list. Same uppercase letterspaced treatment as `Heading`, because "Due now" and
 * "Late" are the same kind of label and reading as two different kinds was the
 * only thing making the reminder look like it came from a different app.
 */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: email.textSoft,
        margin: '22px 0 0',
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
