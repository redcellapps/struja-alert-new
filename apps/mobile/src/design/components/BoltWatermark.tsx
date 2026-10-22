import Svg, { Path } from 'react-native-svg';

/** A large faint bolt, the hero's watermark (about 8 % opacity), cropped by the card's corner. */
export function BoltWatermark({ color, size = 200 }: { color: string; size?: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      opacity={0.08}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        d="M13.6 1.5 4.2 13.4a.6.6 0 0 0 .5 1h5.1l-1.4 7.6a.5.5 0 0 0 .9.4l9.5-12a.6.6 0 0 0-.5-1h-5.1l1.5-7.5a.5.5 0 0 0-.9-.4Z"
        fill={color}
      />
    </Svg>
  );
}
