import { memo } from 'react';

import type { FollowUpSuggestionId } from '@/features/chat/follow-up-suggestions';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';

function labelForFollowUpId(
  chat: ReturnType<typeof messages>['chat'],
  id: FollowUpSuggestionId,
): string {
  switch (id) {
    case 'code_error_handling':
      return chat.followUpChipErrorHandling;
    case 'code_refactor':
      return chat.followUpChipRefactorReadability;
    case 'code_explain':
      return chat.followUpChipCodeExplain;
    case 'code_optimize':
      return chat.followUpChipCodeOptimize;
    case 'code_add_tests':
      return chat.followUpChipCodeAddTests;
    case 'code_fix_error':
      return chat.followUpChipCodeFixError;
    case 'web_more_details':
      return chat.followUpChipWebMoreDetails;
    case 'web_find_sources':
      return chat.followUpChipWebFindSources;
    case 'web_verify_claim':
      return chat.followUpChipWebVerifyClaim;
    case 'research_deeper':
      return chat.followUpChipResearchDeeper;
    case 'date_shorter_summary':
      return chat.followUpChipShorterSummary;
    case 'date_main_risks':
      return chat.followUpChipMainRisks;
    case 'email_make_formal':
      return chat.followUpChipEmailMakeFormal;
    case 'email_shorten':
      return chat.followUpChipEmailShorten;
    case 'generic_simpler_terms':
      return chat.followUpChipSimplerTerms;
    case 'generic_concrete_example':
      return chat.followUpChipConcreteExample;
    case 'generic_bullet_points':
      return chat.followUpChipBulletPoints;
    case 'generic_create_table':
      return chat.followUpChipCreateTable;
    case 'generic_action_checklist':
      return chat.followUpChipGenericActionChecklist;
    case 'generic_assumptions':
      return chat.followUpChipGenericAssumptions;
    case 'learn_technical_detail':
      return chat.followUpChipLearnTechnicalDetail;
    case 'learn_build_walkthrough':
      return chat.followUpChipLearnBuildWalkthrough;
    case 'learn_compare_alternatives':
      return chat.followUpChipLearnCompareAlternatives;
    case 'wf_run_checks':
      return chat.followUpChipWfRunChecks;
    case 'wf_git_commit':
      return chat.followUpChipWfGitCommit;
    case 'wf_compare_options':
      return chat.followUpChipWfCompareOptions;
    case 'wf_verify_acceptance':
      return chat.followUpChipWfVerifyAcceptance;
    case 'ops_fix_config':
      return chat.followUpChipOpsFixConfig;
    case 'ops_channel_next':
      return chat.followUpChipOpsChannelNext;
    case 'ops_schedule_cron':
      return chat.followUpChipOpsScheduleCron;
    case 'what_next':
      return chat.followUpChipWhatNext;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export const ChatFollowUpChips = memo(function ChatFollowUpChips({
  suggestions,
  disabled,
  onPick,
}: {
  suggestions: FollowUpSuggestionId[];
  disabled?: boolean;
  onPick: (id: FollowUpSuggestionId) => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  if (suggestions.length === 0) return null;

  return (
    <div
      className="mb-2 flex flex-wrap gap-2"
      role="group"
      aria-label={m.chat.followUpSuggestionsAria}
    >
      {suggestions.map((id) => {
        const label = labelForFollowUpId(m.chat, id);
        return (
          <button
            key={id}
            type="button"
            disabled={disabled}
            className={cn(
              'max-w-full rounded-full border border-edge-subtle bg-surface-hover/60 px-3 py-1.5 text-left text-[0.8125rem] leading-snug text-fg hover:border-accent/40 hover:bg-accent-soft/50 dark:border-edge dark:bg-surface-hover/40',
              interaction.transition,
              interaction.press,
              interaction.focusRingPanel,
              'disabled:pointer-events-none disabled:opacity-50',
            )}
            onClick={() => onPick(id)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
});
