import { Bricolage_Grotesque, Public_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import Footer from './components/Footer.jsx';
import EdgePicker from './edge-picker.jsx';

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const body = Public_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata = {
  metadataBase: new URL('https://runs-on.dev'),
  title: {
    default: 'runs-on.dev — free subdomains',
    template: '%s — runs-on.dev',
  },
  description: 'Claim your own name.runs-on.dev in seconds. Free, forever.',
  openGraph: {
    siteName: 'runs-on.dev',
    type: 'website',
    url: 'https://runs-on.dev',
    title: 'runs-on.dev — free subdomains',
    description: 'Claim your own name.runs-on.dev in seconds. Free, forever.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'runs-on.dev — free subdomains',
    description: 'Claim your own name.runs-on.dev in seconds. Free, forever.',
  },
  // Bing Webmaster Tools ownership. Not a secret -- a verification token is
  // only meaningful when it is publicly readable in the head of the site it
  // vouches for. Google needs no equivalent here: that property is verified
  // against DNS for the whole domain, which also covers claimed subdomains.
  verification: {
    other: { 'msvalidate.01': 'DE16AF61E473E1FDA073BB3E8BBCF342' },
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        {children}
        <Footer />
        <EdgePicker />
      </body>
    </html>
  );
}
