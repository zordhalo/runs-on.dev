import localFont from 'next/font/local';
import { Bitcount_Prop_Single, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import Footer from './components/Footer.jsx';
import Nav from './components/Nav.jsx';
import EdgePicker from './edge-picker.jsx';
import { Analytics } from '@vercel/analytics/next';

// Satoshi stands in for Aeonik (per the style reference's own substitute
// list): geometric, slightly warm, carrying body copy at weight 400.
// Self-hosted from Fontshare (SIL OFL) so nothing loads from a third party.
const satoshi = localFont({
  src: [
    { path: './fonts/Satoshi-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Satoshi-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/Satoshi-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-satoshi',
  display: 'swap',
});

// Bitcount Prop Single (Google Fonts) is the heading voice: a pixel-matrix
// face that rhymes with the dot-map hero. Every h1/h2/h3 renders in it (see
// the heading rule in globals.css); body copy stays Satoshi.
const bitcount = Bitcount_Prop_Single({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-bitcount',
  display: 'swap',
});

// IBM Plex Mono stands in for Input: the utilitarian meta voice used for
// captions, labels, and fine print.
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata = {
  metadataBase: new URL('https://runs-on.dev'),
  title: {
    default: 'runs-on.dev · free subdomains',
    template: '%s · runs-on.dev',
  },
  description: 'Claim your own name.runs-on.dev in seconds. Free, forever.',
  openGraph: {
    siteName: 'runs-on.dev',
    type: 'website',
    url: 'https://runs-on.dev',
    title: 'runs-on.dev · free subdomains',
    description: 'Claim your own name.runs-on.dev in seconds. Free, forever.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'runs-on.dev · free subdomains',
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
    <html lang="en" className={`${satoshi.variable} ${bitcount.variable} ${mono.variable}`}>
      <body>
        <Nav />
        {children}
        <Footer />
        <EdgePicker />
        <Analytics />
      </body>
    </html>
  );
}
