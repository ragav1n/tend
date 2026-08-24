import { Section, Text } from '@react-email/components';
import { APP_NAME } from '@/lib/config';
import { Shell } from './Shell';
import { email, fonts } from './theme';

/**
 * The sign-in code.
 *
 * The code is the whole email, so it gets the treatment the numbers get in the
 * digest: a beige band, and nothing competing with it. One `<td>` rather than six
 * boxes, because Word's engine would break six cells onto two lines on a narrow
 * phone and a code that wraps is a code nobody can read.
 *
 * No unsubscribe, no call to action button. A button here would be a link, and a
 * link is exactly what does not work from an installed app: it opens the browser,
 * which on iOS is a different storage container from the app that asked. That is
 * the whole reason this email carries a code at all, so putting a big button
 * above it would walk people back into the failure.
 *
 * `expiry` is a string rather than a computed time. The token's real lifetime is
 * a project setting, and printing a clock time this side of it would be a
 * confident guess about somebody else's configuration.
 */
export function SignInEmail({
  code,
  appUrl,
  expiry = 'an hour',
}: {
  code: string;
  appUrl: string;
  expiry?: string;
}) {
  return (
    <Shell
      preview={`${code} is your ${APP_NAME} sign-in code.`}
      appUrl={appUrl}
      reason={`You asked to sign in to ${APP_NAME}. If that was not you, nothing has happened: the code does nothing on its own and expires by itself.`}
    >
      <Section style={{ backgroundColor: email.surface }}>
        <Text
          style={{
            fontFamily: fonts.serif,
            fontSize: 24,
            lineHeight: '32px',
            color: email.heading,
            margin: '22px 0 0',
          }}
        >
          Your sign-in code
        </Text>
        <Text style={{ fontSize: 15, lineHeight: '22px', color: email.textSoft, margin: '4px 0 0' }}>
          Type it into the tab or the app you asked from. It works on the phone, the
          laptop, anywhere, as long as it is the same six digits.
        </Text>
      </Section>

      <Section style={{ backgroundColor: email.surface, paddingTop: 20 }}>
        <table
          role="presentation"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          width="100%"
          style={{ borderCollapse: 'separate' }}
        >
          <tbody>
            <tr>
              <td
                align="center"
                style={{
                  backgroundColor: email.tint,
                  borderRadius: 4,
                  padding: '22px 12px',
                }}
              >
                <span
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 34,
                    lineHeight: '40px',
                    fontWeight: 700,
                    // Tight enough to stay one word on a 320px screen, open
                    // enough to read a digit at a time while typing.
                    letterSpacing: '0.22em',
                    color: email.heading,
                    // The right-hand tracking on the last glyph would otherwise
                    // push the whole code off centre.
                    paddingLeft: '0.22em',
                  }}
                >
                  {code}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section style={{ backgroundColor: email.surface, paddingTop: 18 }}>
        <Text style={{ fontSize: 13, lineHeight: '20px', color: email.textSoft, margin: 0 }}>
          It expires in {expiry} and works once. Asking for another one replaces it,
          so use the newest email if you asked twice.
        </Text>
      </Section>
    </Shell>
  );
}
