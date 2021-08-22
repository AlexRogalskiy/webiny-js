import React from "react";
import { useRecoilValue } from "recoil";
import { keyframes } from "emotion";
import styled from "@emotion/styled";
import { Elevation } from "@webiny/ui/Elevation";
import { ButtonFloating } from "@webiny/ui/Button";
import { ReactComponent as AddIcon } from "../../assets/icons/add.svg";
import { TogglePluginActionEvent } from "../../actions";
import { uiAtom } from "../../state";
import { elementsInContentTotalSelector } from "../../state/page/selectors/elementsInContentTotalSelector";
import { usePageEditor } from "~/editor/hooks/usePageEditor";

const pulse = keyframes`
  0% {
    box-shadow: 0 0 0 0 rgba(0,204,176, 0.4);
  }
  70% {
      box-shadow: 0 0 0 30px rgba(0,204,176, 0);
  }
  100% {
      box-shadow: 0 0 0 0 rgba(0,204,176, 0);
  }
`;

const AddBlockContainer = styled<"div", { displayMode: string }>("div")(({ displayMode }) => {
    const marginLeft = displayMode === "desktop" ? 54 : 0;
    return {
        position: "absolute",
        zIndex: 11,
        top: "50%",
        left: "50%",
        transform: "translate(-50%,-50%)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        width: "150px",
        height: "100px",
        borderRadius: 2,
        color: "var(--mdc-theme-on-surface)",
        marginLeft,

        "& .elevation": {
            backgroundColor: "var(--mdc-theme-surface)",
            padding: displayMode === "mobile-portrait" ? "16px 8px" : "30px 20px",
            transform: "translateY(-50%)",
            borderRadius: 2
        }
    };
});

const AddBlockContent = styled<"div", { displayMode: string }>("div")(({ displayMode }) => ({
    width: displayMode === "mobile-portrait" ? 280 : 300,
    margin: 5,
    textAlign: "center",
    display: "flex",
    alignItems: "center"
}));

const AddContent = () => {
    const { displayMode } = useRecoilValue(uiAtom);
    const totalElements = useRecoilValue(elementsInContentTotalSelector);
    const { app } = usePageEditor();
    if (totalElements) {
        return null;
    }

    const onClickHandler = () => {
        app.dispatchEvent(
            new TogglePluginActionEvent({
                name: "pb-editor-search-blocks-bar"
            })
        );
    };
    return (
        <AddBlockContainer data-type={"container"} displayMode={displayMode}>
            <Elevation z={4} className={"elevation"}>
                <AddBlockContent displayMode={displayMode}>
                    Click the
                    <ButtonFloating
                        data-testid={"pb-content-add-block-button"}
                        style={{ animation: pulse + " 3s ease infinite", margin: "0 10px" }}
                        small
                        icon={<AddIcon />}
                        onClick={onClickHandler}
                    />
                    to start adding content
                </AddBlockContent>
            </Elevation>
        </AddBlockContainer>
    );
};

export default AddContent;
