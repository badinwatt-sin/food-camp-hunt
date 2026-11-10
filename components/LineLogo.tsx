/** LINE application logo: Wikimedia Commons /4/41/LINE_logo.svg, served locally. */
export default function LineLogo({ size = 36 }: { size?: number }) {
  return <img src="/line-logo.svg" width={size} height={size} alt="" aria-hidden="true" style={{ display: 'block', flex: 'none' }} />;
}
