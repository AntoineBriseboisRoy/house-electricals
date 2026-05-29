/*
 * Barrel for the House Electricals design-system primitives.
 *
 * Screens should import from `../ui` rather than reaching into individual
 * files. The barrel keeps the import surface stable as primitives are added.
 */

export { AppShell, APP_TABS, type AppShellProps } from './AppShell.js';
export { BottomTabs, type Tab } from './BottomTabs.js';
export { ScreenHeader, type ScreenHeaderProps } from './ScreenHeader.js';
export {
  Card,
  CardHeader,
  CardTitle,
  CardSubtitle,
  CardActions,
  type CardProps,
  type CardHeaderProps,
  type CardTitleProps,
  type CardSubtitleProps,
  type CardActionsProps,
} from './Card.js';
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button.js';
export { MoveToBuildingButton } from './MoveToBuildingButton.js';
export { IconButton, type IconButtonProps, type IconButtonVariant } from './IconButton.js';
export { Input, type InputProps } from './Input.js';
export { Textarea, type TextareaProps } from './Textarea.js';
export {
  Select,
  type SelectProps,
  type SelectOption,
  type SelectOptGroup,
} from './Select.js';
export { EmptyState, type EmptyStateProps } from './EmptyState.js';
export { Skeleton, type SkeletonProps } from './Skeleton.js';
export { Spinner, type SpinnerProps } from './Spinner.js';
export {
  FloorPlanVectorOverlay,
  type FloorPlanVectorOverlayProps,
} from './FloorPlanVectorOverlay.js';
export {
  PanelVisualization,
  type PanelVisualizationProps,
} from './PanelVisualization.js';
export { Modal, type ModalProps } from './Modal.js';
export { ConfirmModal, type ConfirmModalProps } from './ConfirmModal.js';
export { PromptModal, type PromptModalProps } from './PromptModal.js';
export {
  PickerModal,
  type PickerModalProps,
  type PickerOption,
} from './PickerModal.js';
export { ImpactModal, type ImpactModalProps } from './ImpactModal.js';
export {
  ServiceLogModal,
  type ServiceLogModalProps,
} from './ServiceLogModal.js';
export { Checkbox, type CheckboxProps } from './Checkbox.js';
export { SelectionBar, type SelectionBarProps } from './SelectionBar.js';
export { toast, Toaster } from './toast.js';
export { FilterPopover, type FilterPopoverProps } from './FilterPopover.js';
export {
  FilterTriggerButton,
  type FilterTriggerButtonProps,
} from './FilterTriggerButton.js';
export {
  Combobox,
  type ComboboxOption,
  type ComboboxProps,
} from './Combobox.js';
export {
  SortDropdown,
  type SortDropdownProps,
  type SortOption,
} from './SortDropdown.js';
export { Tooltip, type TooltipProps, type TooltipSide } from './Tooltip.js';
export {
  NoPanels,
  NoFloors,
  NoComponents,
  NoBreakers,
} from './illustrations/index.js';
