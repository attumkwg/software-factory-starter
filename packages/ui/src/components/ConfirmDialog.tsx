import { type ReactNode, useState } from "react";
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
  /** 失敗は呼ぶ側で受け止める(apps/web の useAction)。ここでは待つだけ */
  onConfirm: () => void | Promise<void>;
};

/** 確かめてから実行するダイアログ。開いている間は外に触れず、Esc で閉じる。実行中は二度押せない。 */
export function ConfirmDialog({
  trigger,
  title,
  children,
  confirmLabel,
  isDestructive,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
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
                    isDisabled={pending}
                    onPress={async () => {
                      setPending(true);
                      try {
                        await onConfirm();
                      } finally {
                        setPending(false);
                        close();
                      }
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
