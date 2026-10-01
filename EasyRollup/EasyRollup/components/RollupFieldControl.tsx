import * as React from 'react';

import { IRollupFieldControlProps } from '../EntitiesDefinition';
import {  Field, FluentProvider, Input, Tooltip, webLightTheme } from '@fluentui/react-components';
import { Calculator20Regular } from '@fluentui/react-icons';

export interface IRollupFieldControlState {
  value?: string | null;
  date?: string;
  updated?: string | null | undefined;
  result : "success" | "none" | "error" | "warning" | undefined;
}

export class RollupFieldControl extends React.Component<IRollupFieldControlProps, IRollupFieldControlState> {
  private readonly tooltipId = `easyrollup-${Math.random().toString(36).slice(2)}`;
  private clearMessageTimeout?: ReturnType<typeof setTimeout>;
  private mounted = false;

  constructor(props :IRollupFieldControlProps){
    super(props);
    this.state = { result : "none" };
  }

  public componentDidMount() {
    this.mounted = true;
    this.getData();
  }

  public componentWillUnmount() {
    this.mounted = false;
    if (this.clearMessageTimeout)
      clearTimeout(this.clearMessageTimeout);
  }

  private safeSetState(state: Partial<IRollupFieldControlState>) {
    if (this.mounted)
      this.setState(state as IRollupFieldControlState);
  }

  private refreshData = async () => {
    this.safeSetState({ updated : "Value is being refreshed.. Please wait.", result : "none" });

    const { clientUrl, entityRef, rollupField } = this.props;
    const target = encodeURIComponent(`{'@odata.id':'${entityRef.EntitySetName}(${entityRef.Id})'}`);
    const url = `${clientUrl}/api/data/v9.0/CalculateRollupField(Target=@target,FieldName=@fieldname)?@target=${target}&@fieldname='${rollupField}'`;

    try {
      const response = await fetch(url, {
        method : "GET",
        headers : {
          "Accept" : "application/json",
          "Content-Type" : "application/json; charset=utf-8",
          "OData-MaxVersion" : "4.0",
          "OData-Version" : "4.0"
        }
      });

      if (!response.ok) {
        let message = `${response.status} ${response.statusText}`;
        try {
          message = (await response.json()).error?.message ?? message;
        } catch { /* body was not JSON */ }
        this.safeSetState({ updated : message, result : "error" });
        return;
      }

      await this.getData();
      this.safeSetState({ updated : `${rollupField} was successfully updated.`, result : "success" });

      if (this.clearMessageTimeout)
        clearTimeout(this.clearMessageTimeout);
      this.clearMessageTimeout = setTimeout(() => {
        this.safeSetState({ updated : null, result : "none" });
      }, 3000);
    }
    catch (error) {
      this.safeSetState({ updated : "Error while refreshing data : " + (error as Error).message, result : "error" });
    }
  }

  private getData = async () => {
    const { context, entityRef, rollupField } = this.props;

    try {
      const result = await context.webAPI.retrieveRecord(entityRef.EntityName, entityRef.Id, `?$select=${rollupField},${rollupField}_date`);
      const formattedKey = "@OData.Community.Display.V1.FormattedValue";
      const raw = result[rollupField];

      // The server-formatted value is correct for every type (currency, decimal, whole number, ...)
      this.safeSetState({
        value : raw == null ? null : (result[`${rollupField}${formattedKey}`] ?? String(raw)),
        date : result[`${rollupField}_date${formattedKey}`] ?? result[`${rollupField}_date`] ?? undefined
      });
    }
    catch (error) {
      this.safeSetState({
        updated : "Error while getting data : " + (error as Error).message,
        result : "error"
      });
    }
  }

  public render(): React.ReactNode {
    return (
      <div style={{ width: "100%" }}>
        <FluentProvider theme={webLightTheme}>
          <Tooltip 
            content={this.state.date ? `Last refreshed on ${this.state.date}` : "Not refreshed yet"}
            relationship="label"
            withArrow
            positioning={"above-start"}
          >
            <Field
              validationState={this.state.result ?? "none"}
              validationMessage={this.state.updated}
            >
              <Input
                readOnly
                value={this.state.value ?? ""}
                type="text"
                aria-describedby={this.tooltipId}
                style={{backgroundColor: "#F5F5F5", border: "none"}}
                contentAfter={<Calculator20Regular onClick={() => { this.refreshData(); }} />} 
              />
            </Field>
          </Tooltip>
        </FluentProvider> 
      </div>
    )
  }
}
