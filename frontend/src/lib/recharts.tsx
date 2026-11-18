/* oxlint-disable react/only-export-components */
import type { ReactNode } from "react";
import {
  Tooltip as UpstreamTooltip,
  type TooltipPayloadEntry,
  type TooltipProps as UpstreamTooltipProps,
  type TooltipValueType,
} from "recharts-upstream";

export * from "recharts-upstream";

type NameType = string | number;
type UpstreamProps = UpstreamTooltipProps<TooltipValueType, NameType>;
type TooltipPayload = Parameters<NonNullable<UpstreamProps["labelFormatter"]>>[1];

export type TooltipFormatter<TValue extends TooltipValueType = TooltipValueType, TName extends NameType = NameType> = (
  value: TValue,
  name: TName,
  item: TooltipPayloadEntry,
  index: number,
  payload: TooltipPayload,
) => ReactNode | [ReactNode, ReactNode];

export function Tooltip<
  TValue extends TooltipValueType = TooltipValueType,
  TName extends NameType = NameType,
  TLabel = ReactNode,
>(
  props: Omit<UpstreamTooltipProps<TValue, TName>, "formatter" | "labelFormatter"> & {
    formatter?: TooltipFormatter<TValue, TName>;
    labelFormatter?: (label: TLabel, payload: TooltipPayload) => ReactNode;
  },
) {
  return <UpstreamTooltip {...(props as UpstreamProps)} />;
}
