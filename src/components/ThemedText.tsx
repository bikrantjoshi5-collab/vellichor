import React from 'react';
import { Text, type TextProps } from 'react-native';
import { typography, type TypographyVariant } from '@/theme';

export interface ThemedTextProps extends TextProps {
  variant?: TypographyVariant;
}

export function ThemedText({ variant = 'body', style, ...rest }: ThemedTextProps) {
  return <Text style={[typography[variant], style]} {...rest} />;
}
