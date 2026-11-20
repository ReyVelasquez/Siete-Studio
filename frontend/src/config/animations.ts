/**
 * =============================================================================
 * CENTRALIZED FRAMER MOTION ANIMATION PRESETS
 * =============================================================================
 * Toggle `ANIMATIONS_ENABLED` or adjust durations/easings here to control
 * motion globally across pages, modals, lists, and sticker microinteractions.
 */

import type { Transition, Variants } from "framer-motion";

export const ANIMATIONS_ENABLED = true;

export const MOTION_EASE = [0.22, 1, 0.36, 1] as const;

export const MOTION_SPRING: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 30,
  mass: 0.8,
};

export const pageTransitionVariants: Variants = ANIMATIONS_ENABLED
  ? {
      initial: { opacity: 0, y: 12 },
      animate: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.34, ease: MOTION_EASE },
      },
      exit: {
        opacity: 0,
        y: -8,
        transition: { duration: 0.2, ease: MOTION_EASE },
      },
    }
  : {
      initial: { opacity: 1 },
      animate: { opacity: 1 },
      exit: { opacity: 1 },
    };

export const staggerContainerVariants: Variants = ANIMATIONS_ENABLED
  ? {
      hidden: { opacity: 0 },
      visible: {
        opacity: 1,
        transition: {
          staggerChildren: 0.055,
          delayChildren: 0.04,
        },
      },
    }
  : {
      hidden: { opacity: 1 },
      visible: { opacity: 1 },
    };

export const staggerItemVariants: Variants = ANIMATIONS_ENABLED
  ? {
      hidden: { opacity: 0, y: 14 },
      visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.32, ease: MOTION_EASE },
      },
    }
  : {
      hidden: { opacity: 1 },
      visible: { opacity: 1 },
    };

export const modalBackdropVariants: Variants = ANIMATIONS_ENABLED
  ? {
      hidden: { opacity: 0 },
      visible: { opacity: 1, transition: { duration: 0.2 } },
      exit: { opacity: 0, transition: { duration: 0.16 } },
    }
  : {
      hidden: { opacity: 1 },
      visible: { opacity: 1 },
      exit: { opacity: 0 },
    };

export const modalPanelVariants: Variants = ANIMATIONS_ENABLED
  ? {
      hidden: { opacity: 0, scale: 0.96, y: 16 },
      visible: {
        opacity: 1,
        scale: 1,
        y: 0,
        transition: { duration: 0.28, ease: MOTION_EASE },
      },
      exit: {
        opacity: 0,
        scale: 0.97,
        y: 10,
        transition: { duration: 0.18, ease: MOTION_EASE },
      },
    }
  : {
      hidden: { opacity: 1 },
      visible: { opacity: 1 },
      exit: { opacity: 0 },
    };

export const conditionalFieldVariants: Variants = ANIMATIONS_ENABLED
  ? {
      initial: { opacity: 0, height: 0, y: -6 },
      animate: {
        opacity: 1,
        height: "auto",
        y: 0,
        transition: { duration: 0.26, ease: MOTION_EASE },
      },
      exit: {
        opacity: 0,
        height: 0,
        y: -4,
        transition: { duration: 0.18, ease: MOTION_EASE },
      },
    }
  : {
      initial: { opacity: 1 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
    };

export const stickerTapInteraction = ANIMATIONS_ENABLED
  ? { whileHover: { y: -2 }, whileTap: { scale: 0.985 } }
  : {};
