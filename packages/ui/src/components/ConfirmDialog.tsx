import type { ReactNode } from "react";
import { Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "./Button.tsx";

export type ConfirmDialogProps = {
  /** ダイアログを開くボタン(Button を1つ) */
  trigger: ReactNode;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** 消すなど戻せない操作なら true(赤いボタン) */
  isDestructive?: boolean;
  onConfirm: () => void | Promise<void>;
};

/** 確かめてから実行するダイアログ。開いている間は外に触れず、Esc で閉じる。 */
export function ConfirmDialog({
  trigger,
  title,
  children,
  confirmLabel,
  isDestructive,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <DialogTrigger>
      {trigger}
      <ModalOverlay className="ui-overlay" isDismissable>
        <Modal className="ui-modal">
          <Dialog className="ui-dialog" role={isDestructive ? "alertdialog" : "dialog"}>
            {({ close }) => (
              <>
                <Heading slot="title" className="ui-dialog__title">
                  {title}
                </Heading>
                <div>{children}</div>
                <div className="ui-dialog__actions">
                  <Button onPress={close}>やめる</Button>
                  <Button
                    variant={isDestructive ? "danger" : "primary"}
                    onPress={async () => {
                      await onConfirm();
                      close();
                    }}
                  >
                    {confirmLabel}
                  </Button>
                </div>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
